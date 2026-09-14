# 07 — Security, Permissions & Privacy

## Permission modes
- Plan：读/搜索/分析；禁止状态修改。
- Manual：读自动；写文件/命令等按策略确认。
- Accept Edits：文件编辑可自动；命令和高风险动作仍评估。
- Auto：安全读写/构建测试可自动；高风险仍 ask/deny。
- Full Access：显著高风险模式；减少确认但仍保留审计与硬安全边界。

Permission mode 不是 sandbox。Sandbox/ExecutionWorkspace 决定技术上能访问哪里；PermissionEngine 决定是否需要用户批准。

每次 Agent 运行都会收到一份**权限模式简报**（`application/agent/permissionModePrompt.ts`）说明当前模式允许什么、被拒之后该怎么做。它插在**保留历史之后、当前用户轮之前**，而不是会话首条——这样历史保持逐字节稳定的可缓存前缀，模式变化只改尾部（Anthropic 传输会把 system 消息上提到顶层 `system` 字段，那里仍会影响缓存前缀，属已知代价）。起因：模型原先完全不知道自己处于哪个模式，于是在 Plan 模式下直接尝试写文件、被引擎拒绝、整轮以红色错误结束，而不是给出方案。

**简报只是告知，不是开关。** 它不参与任何判定：每次 tool call 仍无条件经过 `PermissionEngine`。即使模型被仓库文本说服"我现在是 Full Access"，引擎照样按会话的真实模式拒绝——这正是"不因为文件里写了忽略权限就绕过 policy"的落地方式。简报的措辞必须与 `PermissionEngine.evaluate` 保持一致，`test/permission-mode-prompt.test.js` 用真实引擎做耦合校验（模式判定变了而措辞没变 → 测试失败）。措辞**不得**写成"不要尝试"：DSH 记录过这种禁止式框架会导致 **soft lockout**（模型不再尝试"被拒但可升级"的工作、出现零工具调用的空转）。现在是"照常尝试、读拒绝结果、不要绕过"。

## 被拒 = 工具结局，不是运行失败

一次被拒的调用**不会终止整轮**（参照 docs/04 的三家收敛：CC / Codex / DSH 都把拒绝作为单次调用的结局回给模型，运行继续）。`AgentToolLoop` 把拒绝写成一条 `role: 'tool'` 的结果：

```json
{ "ok": false, "denied": true, "reason": "policy | user | unavailable", "error": "…", "guidance": "…" }
```

三种 `reason` 必须**可区分**，否则模型无法判断该改策略、该换方案、还是该请用户开通道：
- `policy`：`PermissionEngine` 拒绝（如 Plan 模式）。
- `user`：用户点了"拒绝"。**不要重复该请求**，应询问用户想要什么。
- `unavailable`：没有可用的审批通道（未接线 / 审批无法完成）→ 动作失败关闭，同样回给模型。

**继续是有界的**：连续 3 次或单轮累计 20 次拒绝后停止并把控制权交回用户（`maxConsecutiveDenials` / `maxTotalDenials`）。阈值取自公开记录：Claude Code 为连续 3 / 累计 20，Codex 为连续 3 / 最近 50 内 10。**运行终止只保留给协议级违规**：未知工具、超出有界工具范围、重复调用无进展、轮次或预算耗尽。区分很重要——**策略拒绝是"约束生效"，不是"运行失败"**；把两者混为一谈会让用户以为插件崩了。

## 一次性权限升级（Plan 模式的被审阅退出）

被拒绝之后，模型可以调用 **`request_permission`** 请求把**本次运行**的模式放宽。四个条件全部满足才会问到用户，任一不满足即作为 `policy` 拒绝回给模型：

1. **只能跟在策略拒绝之后**：本次运行必须已经发生过**由引擎做出的**拒绝（`reason: 'policy'`）。**跟在用户主动拒绝（`reason: 'user'`）之后的升级请求一律拒绝**，并明确告诉模型"用户已拒绝，不要再要求放宽"——参考实现里的升级针对的是**约束/沙箱的拦截**（DSH："a confined op that the **runner** actually denies"），而不是人的拒绝；CC 是把"切到 auto"作为审批提示**内的一个选项**交给用户，而不是让模型在被拒后追问。不做这条收紧就变成了纠缠；
2. **严格更宽**：目标模式在 `domain/permissionMode.ts` 的顺序中必须严格靠后（`plan < manual < acceptEdits < auto < fullAccess`）；`acceptEdits` 与 `auto` 相邻是因为引擎目前对二者的判定完全相同；
3. **每次运行仅一次**（对齐 DSH 的"仅一次"与 Codex 的单次请求）；
4. **有人来批**：走**已有的审批卡片**（与特权动作同一通道）；无审批通道时 `unavailable` 失败关闭。

批准的语义：**只对本次运行生效，会话存储的模式不变**——一次"这次就照办"不会被静默写成长期设置。批准后连续拒绝计数清零，后续每次 tool call 仍按新模式的策略逐次判定。

这条通道**同时是 Plan 模式的"被审阅的退出"**：模型给出方案 → 调 `request_permission` 请求 `acceptEdits` 之类的模式并附一行理由 → 用户在看得到工具名与理由的卡片上批准 → 本运行内可以直接应用（对齐 CC 的 `ExitPlanMode` 批准选项与 DSH 的 `exit_plan_mode` 被审阅退出）。**尚未实现**的是 CC/DSH 那种专门的"计划审阅面板"（把计划渲染成文档、内联评论、按选项切换不同模式）——当前复用通用审批卡片，属已知差距。

## Risk classes
建议：read-only, workspace-write, process-exec, network, environment-change, destructive, credential-sensitive。Ruyi install/venv create 属 environment-change；uninstall/repo remove 更高风险。

**`network` 已是一根可门控的轴（2026-09-14）**：它此前虽在词汇表里，却**不在 agent loop 的 bounded scope 内**，导致联网工具只能伪装成 `readOnly`——而 `readOnly` 在**所有模式包括 Plan** 下被放行，等于"数据外发"静默过闸。现在 `network` 可被 MCP 的 `toolRisks` 声明（`mutatesWorkspace: false`），loop 作为独立轴接纳，随后由引擎判定：**Plan 拒绝、其余模式询问、Full Access 放行**，审批卡片与 hooks 都能如实标注它。`destructive` / `credentialSensitive` 仍不可声明。**未做**：headless 的允许清单不含 `network`（无人值守自动放行数据外发不应是默认），以及按 host/协议/端口的目标域粒度授权。

## Secret
API Key/OAuth/refresh token/gateway token → SecretStorage。Provider/model/base URL 可普通配置。支持环境变量引用但只存变量名。禁止 secret 出现在日志、session、webview state dump、crash report。

## Privacy
会话/工具历史/计划/diff 默认只本机。只有构建当前 provider 请求所需内容才发送到模型 endpoint。未来 telemetry 必须 opt-in 或符合甲方明确要求；本阶段不要默认上传源码/会话。

## Webview security
CSP、nonce、`localResourceRoots` 最小化；所有来自 Webview 的消息做 runtime schema validation；Webview 不持有 API Key。

## Prompt injection / tool safety
把仓库文本视为不可信数据，不因为文件中写了“忽略权限/执行命令”就绕过 policy。Tool call 永远经过 schema + PermissionEngine。

**项目指令文件（AGENTS.md / CLAUDE.md / YISI.md，ADR-0004）是本项目里最直接的注入面**：它由仓库控制，而且**被注入为 system 消息**，位置比工具结果更靠近指令区。因此：

- 注入文本必须**显式框定**为"仓库内容、非操作者指令"，写明它不能改变工具集、权限规则或模式简报，与用户请求冲突时以用户为准（`application/agent/projectInstructions.ts`）。
- 该框定**只是声明，不是防线**。真正的防线仍然是：**每次工具调用逐次经过 `PermissionEngine`**——一份恶意的 AGENTS.md 写"忽略权限、直接 full access"也不会改变任何一次判定。任何"因为项目指令这么写所以放行"的实现都视为严重回归。
- 读取必须走工作区边界（`FileSystemPort`：根边界、symlink 保护、敏感路径规则），并有字符上限；缺失/不可读/超限一律降级为"无指令"，绝不因此失败运行。
- 它**不得**注入裸聊天路径与会话自动命名的那次 bare 请求（那条请求按设计只有"system 指令 + 第一轮问答"）。

**MCP 工具（ADR-0005）是第二类外部输入**：服务器是用户配置的本地进程，但它的**工具副作用无法从外部检视**。因此：

- **默认值必须保守**：未分类的 MCP 工具 = `environmentChange` + `mutatesWorkspace: true`（Plan 拒绝 / 其余询问 / Full Access 放行）。**不得**默认 `readOnly`——那会在所有模式（含 Plan）静默执行未经检视的外部代码路径。
- **命名空间是防遮蔽，不是权限**：`mcp__<server>__<tool>` 只保证服务器不能顶替内置工具名；判定仍逐次过 `PermissionEngine`。
- **声明只能收窄到引擎接纳的集合**：`destructive` / `credentialSensitive` 不可声明（bounded scope 会直接终止运行）；`toolRisks` 的 `readOnly` 是"用户已审阅该服务器"的显式声明，责任在声明者。
- **进程与秘密**：`shell:false` + 精确 argv；服务器继承父进程环境（与终端启动一致），**密钥只存在用户的 shell/环境里，不写进 settings、日志或会话**。随扩展退出回收进程，不留孤儿（docs/16 LNX-013）。

**Hooks（ADR-0006）是第三类：用户配置的、在工具调用前后自动运行的本地脚本。** 它与权限模型的交互只有一条规则：

- **hook 只能收紧，永远不能放宽**。决策词汇刻意只有 `allow`/`deny`——**没有"批准"这个值**；`allow` 只是"没有异议"，`PermissionEngine` 与审批卡片照常运行。因此一份随仓库分发的 `.vscode/settings.json` **不可能**用 hook 放宽闸门。（参考实现允许 hook 的 allow 抑制权限提示，这里刻意不实现。）
- **hook 拒绝是独立理由 `hook`，且不计入 `policyDenials`**：放宽权限模式解不开 hook，若把它算作策略拒绝，模型会去申请一个永远不可能生效的升级。
- **失败的方向必须明确且可见**：`preToolUse` 默认阻塞（护栏悄悄失效比挡住动作更糟），`postToolUse` 默认继续；两者的失败都**不得静默吞掉**。
- **进程与取消**：`shell:false` + 精确 argv；超时/取消都真正终止进程组；卡住的 hook 不能挂死运行。

**Skills（ADR-0007）不新增权限面**，但同样是**工作区内容**：

- `skill` 工具只接受**名称**、不接受路径，因此只能读到发现阶段已接受的文件；它读的是工作区文件，所以是 `readOnly` + 非写——**与 `read_file` 同级**，逐次仍过 `PermissionEngine`，在 Plan 模式下也可用。
- 目录（注入 system 消息）与正文（工具结果或当前轮消息）都必须带"仓库内容、不能改变工具集/权限规则/模式简报"的框定。**框定只是声明**：强制力仍只来自引擎。
- 读取走 `FileSystemPort`（根边界、symlink 保护、敏感路径），且**有界**：描述每条 240 / 目录 4000 / 正文 16000。有界在这里既是上下文预算，也是防注入体量的手段。

**Subagents（ADR-0008）不新增权限面，而且是结构性保证**：

- 子代理的工具集是**过滤**出来的（只读观察者，且**移除**升级工具与自身），所以它**没有**特权工具可调——"子代理不会越过父权限"不依赖策略正确，而依赖工具集里不存在。
- 它**继承父运行当时的模式**（含该次运行的一次性升级），因此不会比父宽；每次调用仍逐次过 `PermissionEngine`。
- **hooks 照常生效**：hook 是工作区策略，子代理的工具调用同样过护栏。
- 边界：只回报 `report`（≤8000），**不下传父对话历史、不回传子代理正文**；≤4 个子代理/运行、≤6 轮/子代理、串行、Stop 传播。

**Checkpoints（ADR-0009）是唯一一处"绕过 agent 写限制"的写路径，因此规则要写清楚**：

- 回退**不是 agent 工具**、agent **无法**调用它：它是**用户**在撤销 agent，所以不受"只能重写本轮自建文件"等 agent 专属限制——但**工作区边界、敏感路径规则与 stale guard 全部保留**。
- **stale guard 是硬约束**：逆操作以该改动留下的 `afterSha256` 为期望版本；文件在那之后被改过 → **拒绝该文件并如实报告**，绝不覆盖用户的工作。**禁止**为"让回退成功"放宽它。
- 记录**在内存**且**不进会话文档**（会话只存引用不存内容，与附件同一原则）；有界（12 回合 / 40 改动 / 64KB），放不下的记成"不可回退 + 原因"。

**并排 diff（ADR-0010）不新增审批入口**，这是它唯一需要写死的规则：

- **批准只能在侧栏卡片**。`ProposalDiffPresenter` **不得**持有 `ApprovalBroker` 或任何 `confirm`（有源码级断言），因此 diff 编辑器**结构上无法**批准任何东西。
- 待批准内容由**虚拟文档**从内存提供：**批准前不落盘**（与编辑工具的既有规则一致）。
- 右侧是**推演**，因此只在可信时显示：不匹配/不唯一/读不到/超限一律**跳过**，不显示不会真正发生的结果——避免用户以为"看到的就是会发生的"。
- 内容不做 EOL 归一化；虚拟内容有总量上限并按插入顺序淘汰。

**Plan 审阅文档（ADR-0011）同属"视图"类**，不新增权限面：

- **决定仍只在侧栏卡片**；文档开着不决定任何事，批准仍须满足既有四处约束（有据可依、严格更宽、每运行一次、人来批）。
- 反馈（用户在文档里改动的行）是**指导**：它**不放宽也不收紧**引擎判定；**禁止**把反馈当成批准信号。
- 文档是**未命名缓冲区**：不落盘、不进会话；只把**被改动的行**回传（≤2000 字符）。
