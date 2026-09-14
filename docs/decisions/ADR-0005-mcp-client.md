# ADR-0005 — MCP 客户端（外部工具接入）

## Status
Accepted

## Decision
Yisi AI 通过 **MCP（Model Context Protocol）** 接入外部工具：用户在 `yisiAI.mcpServers` 里配置本地服务器，Yisi 以 **stdio + JSON-RPC 2.0** 连接，把服务器的工具桥接成 Agent 工具。

### 连接与生命周期
- **每个配置项一个子进程**：`spawn(command, args, { shell: false })`，精确 argv，**绝不拼 shell 命令串**（与 `NodeProcessRunner` 一致）。
- **默认零成本**：没有配置任何服务器时不创建服务、不启动进程、不增加启动耗时。
- **连接一次并 memoize**：Agent 的工具清单属于请求前缀，会话中途不能变形；`refresh()` 是显式重连入口。
- **失败即降级**：连接超时（默认 10s）、进程崩了、协议说错了，都只产出一条 `McpServerStatus.error` + 零个工具，**绝不让 Agent 运行失败**。
- **随扩展退出**：`dispose()` 关闭全部连接；Linux 下用进程组终止（复用 `ProcessTreeController`），**不留孤儿进程**（docs/16 LNX-013）。

### 工具命名与权限映射
- 工具 id 固定为 **`mcp__<server>__<tool>`**：`mcp__` 前缀为保留命名空间，MCP 服务器**不可能遮蔽**内置工具（`run_command`、`replace_text` …）。调用时使用服务器的**原始工具名**，只有 id 被清洗。
- **未分类的 MCP 工具默认 `environmentChange` + `mutatesWorkspace: true`**。理由：MCP 服务器的副作用无法从外部检视，`readOnly` 会在**所有模式包括 Plan** 下静默执行，这是不诚实的默认值；`environmentChange` 与仓库既有的 `ruyi_manage`（同样是"本地配置的、不透明的环境操作"）同类——Plan 拒绝、其余模式询问、Full Access 放行。
- 用户可在配置里按工具**收窄**风险（`toolRisks`）。`destructive` / `credentialSensitive` **不允许声明**：Agent loop 的 bounded scope 直接拒绝这两类，声明它们只会把"权限判定"变成"运行直接死掉"。
- `(risk, mutatesWorkspace)` 组合在桥接层被**规范化**成 loop 接纳的四种之一；测试把这张表与真实 loop 耦合校验。

### 修订（2026-09-14）：`network` 成为可声明的第五类
原先可声明的只有 `readOnly` / `workspaceWrite` / `processExec` / `environmentChange`，于是**一个联网工具只能伪装成 `readOnly`**——而 `readOnly` 会在**所有模式包括 Plan** 下被引擎放行，等于"数据外发"静默通过闸门。这与 `docs/14` 早就记下的空白一致：「`network` 是新的轴，不是 workspace-write 的同级风险」。

现在：`network` 可声明（`mutatesWorkspace: false`），loop 把 `network` 作为**独立的一根轴**接纳（不再报"outside the bounded Agent tool scope"），随后由引擎判定——**Plan 拒绝、其余模式询问、Full Access 放行**，审批卡片与 hooks 都能如实看到它。`destructive` / `credentialSensitive` 仍然一律不可声明。**未做**：headless 的允许清单**不含 `network`**（无人值守时自动放行数据外发不应成为默认），以及 `network` 的**目标域**粒度（host/协议/端口级授权尚未实现）。

### 通信细节
- 每次请求都有超时（默认 60s），支持 `AbortSignal` 取消（Stop 因此可用）。
- 主动请求（`sampling` / `roots` 等 Yisi 未实现的方法）以 JSON-RPC `-32601` **明确应答**而不是忽略——服务器等一个永不到来的答复会表现为卡死。
- `tools/list` 分页有页数上限；stdout 单行有长度上限；stderr 有界保留并进入失败原因（服务器启动即死通常在 stderr 里说明了自己）。
- 结果**有界**（头 6000 + 尾 2000 字符，中间省略有标记）；非文本内容（图片等）被**如实描述**而不是静默丢弃。

## Reasons
1. 与 CC / Codex 对照，MCP 是投入产出比最高的缺口：一个协议换来整个外部工具生态（数据库、GitHub、Figma…）。docs/04 只记录了"学行为不抄实现"，协议本身是公开规范。
2. 只做三件事（`initialize` / `tools/list` / `tools/call`）就够支撑真实使用，先跑通 vertical slice 再谈采样、roots、资源、prompt。
3. 传输抽象成 port，协议层可用内存传输测试——**不需要 spawn 就能验证 90% 的行为**，真实子进程只验传输本身。
4. 权限默认值必须保守且**可解释**：宁可让 Full Access 也问一次，也不能让未经检视的外部工具在 Plan 模式下静默执行。

## Consequences
- 用户每配置一个服务器就多一个常驻子进程；服务器继承父进程环境（与从终端启动一致，也让 `npx` 之类能工作）。**秘密只进用户的 shell/环境，不进 settings**。
- 工具清单在会话中途固定；服务器换工具需要重载扩展（`refresh()` 目前无 UI 入口，属已知缺口）。
- 未实现（明确记录，非遗漏）：HTTP/SSE 传输、MCP 资源与 prompt、`sampling`/`roots`、采样审批、工具清单变化的动态刷新、UI 上的服务器状态面板。
- 本机未验证：VS Code 内 F5 用真实第三方 MCP 服务器（例如 filesystem 服务器）实测；本机验证止于自建 fixture 服务器。

## Verification
- `test/mcp-client.test.js`（25 个）：握手与身份、`tools/list` 解析/跳过畸形项/游标分页与页数上限、`tools/call` 参数与结果、JSON-RPC 错误、服务器主动请求被应答、请求超时、迟到应答被忽略、取消、断线拒绝在途请求；桥接的命名空间与保留前缀、默认风险与规范化、非文本描述、结果截断；**经真实 Agent loop 的端到端权限行为**（Plan 拒绝且不调服务器、Manual 询问一次且批准后才调、用户拒绝则永不触达、Full Access 免问、用户声明 readOnly 才免问）；服务层的多服务器桥接、禁用/重名处理、连接失败降级、连接超时有界、refresh/dispose。
- `test/mcp-stdio-transport.test.js`（8 个）：真实子进程上的完整往返、工具错误、**在途调用取消后连接仍可用**、close 后客户端断开、**close 之后子进程确实被回收（探测 pid，而非依赖子进程自己的退出处理器）**、启动即死时上报 stderr、可执行文件不存在时不挂起、服务层驱动真实进程端到端。
- `test/mcp-configuration.test.js`（10 个）：配置解析的全部拒绝路径（非数组、缺 name/command、畸形 args、非法 risk、重名）、坏条目不影响好条目、组合根接线与 manifest 声明守卫。
- 全量：**527 tests / 526 pass / 0 fail / 1 skip**（本里程碑 ① 时为 484）。

## 开发过程中的两次真实纠错
1. 断言 `toolMessage.output`，实际 loop 把成功序列化为 `{ ok, result, truncated }` —— 断言错了，改为 `toolMessage.result.output`。
2. "回收子进程"最初靠 fixture 在退出时删除 marker 文件，Windows 上 `SIGTERM` 由 `TerminateProcess` 模拟、JS 退出处理器不会运行，测试因此**假失败**。改为直接对 pid 做 signal-0 存活探测——这才是"没有孤儿进程"的真正证据。
