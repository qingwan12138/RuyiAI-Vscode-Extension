# ADR-0013 — 联网搜索：以内置 MCP 服务器交付

## Status
Accepted（2026-09-14）

## Decision

联网能力**不新增宿主侧框架**，而是作为**一个随扩展分发的 MCP 服务器**交付：`src/yisi/mcp-server/websearch/`。它说扩展**已经实现**的那套 MCP（stdio + 换行分隔 JSON-RPC 2.0：`initialize` / `tools/list` / `tools/call`），贡献两个工具：

| 工具 | 桥接后的 id | 风险 |
|---|---|---|
| `web_search` | `mcp__websearch__web_search` | `network` |
| `web_fetch` | `mcp__websearch__web_fetch` | `network` |

因此它**天然继承**已有的全部纪律，一行权限代码都不用新写：逐次过 `PermissionEngine`、Plan 拒绝 / 其余模式询问 / Full Access 放行、审批卡片如实标注、hooks 可拦、`dispose()` 回收子进程、失败只降级成一个零工具的服务器状态。

```
用户配置 yisiAI.mcpServers  ──►  MCP 客户端（已有）
                                     │
                                     ├─ mcp__websearch__web_search ─► SearXNG（用户自建，免费）
                                     └─ mcp__websearch__web_fetch  ─► 任意公网 http(s) 页面
```

### 为什么是 MCP，而不是宿主侧内置工具
- `docs/12` 把 v0.13-① 卡住的原因是**产品/法务决策**（`docs/14` 评估的 8 家供应商，智谱那条要求算法备案）。把联网做成 MCP 服务器，**供应商选择就不再是产品决定**：服务器只认一个 `YISI_SEARXNG_URL` 指向的 JSON 搜索端点，SearXNG 是**用户自己在自己机器上跑**的东西 —— 不存在把闭源 VSIX 暴露给带 ToS 约束的商业 API，也不存在备案义务落在本产品头上。
- **成本**：SearXNG 免费、自建、无 API key。**不花钱买搜索服务**是硬约束，这条路径是唯一同时满足"通用型联网搜索"和"零采购"的。
- 服务器是**普通进程**，不是新的宿主依赖：它由 `tsc` 从同一份 `src/` 编译到 `dist/`，随 VSIX 分发，用户不需要 `npm install` 任何东西。
- clean-room：本服务器只实现**公开协议**与 `docs/14` 早已记录的抓取约束，未读取或复刻任何参考实现。

### 权限与安全（本 ADR 的核心）
1. **必须声明 `network`，禁止伪装 `readOnly`。** 这是 `docs/14` 记下的那个空白（2026-09-14 已把 `network` 做成可门控的轴）。声明 `readOnly` 会让联网工具在**所有模式包括 Plan** 下静默通过闸门 —— 数据外发而用户看不见。
2. **`web_fetch` 的 SSRF 策略是一门独立的闸门**（`urlPolicy.ts`），它不依赖权限引擎：只允许 `http`/`https`、URL ≤2048、禁止 URL 内嵌凭据、**解析一次、任一答案非公网单播即整体拒绝**、**跨源重定向一律失败**、`maxRedirects` 仅同源 ≤5、5MB / 100k 字符 / 30s、内容类型非文本则拒绝。上限值就是 `docs/14` 记录的那组，有测试锁定（`the defaults match the specification recorded in docs/14`）。
3. **搜索后端与 `web_fetch` 刻意不对称**：后端是**用户自己配置的**端点（默认 `http://127.0.0.1:8080`，通常就是回环地址，而回环正是公网策略要拒绝的），模型只控制 query 串且已被编码；所以后端**不走** SSRF 策略。这不是"策略被跳过"，而是**信任边界不同**：模型自己给的 URL 才需要检查。
4. **诚实登记残余风险**：先校验解析结果再用主机名请求，中间存在一个很小的 TOCTOU 窗口（DNS 可以第二次给出不同答案）。把连接钉在已校验地址集上需要自定义 dispatcher，本轮未做。**公网 URL 依然可以收到模型发去的任何内容** —— 策略收窄 SSRF，不消灭它，工具描述里如实写着这一点。
5. **降级必须诚实**：没有后端、连不上、后端不返回 JSON、页面非文本、重定向出源 —— 每一种都给出**具体原因**，绝不用"没有结果"冒充"搜过了"。系统提示词另有硬约束：**只有在搜索/抓取工具真的跑成功时才可以说自己联网查过**。

### 后端地址为什么在环境变量里，而不是 settings
`yisiAI.mcpServers` **刻意不支持 `env` 字段**（本轮确认：解析器会静默忽略未知字段）。这是一条要保留的边界 —— 一旦支持，`settings.json` 就会变成放 token 的地方，而 MCP rule 明确要求"秘密只进用户的 shell/环境"。搜素后端属于配置而非秘密，所以它走 `YISI_SEARXNG_URL` 环境变量，与其它 MCP 服务器一致。

> 副作用（如实记录）：**改后端地址需要能设置环境变量**。默认值 `http://127.0.0.1:8080` 覆盖"在本机跑一个 SearXNG"这个主场景，因此默认路径零配置。

### 用户怎么开
命令 `Yisi AI: Copy Web Search (MCP) Configuration`（`yisiAI.webSearch.setup`）把**含真实安装路径**的 `yisiAI.mcpServers` 条目复制到剪贴板。路径只能运行时求值 —— 扩展装在**带版本号的目录**里，任何硬编码路径都是错的。

## Consequences
- 新增 3 个模块：`mcp-server/websearch/urlPolicy.ts`（纯策略）、`webTools.ts`（两个工具 + SearXNG 后端）、`server.ts`（协议层 + stdio 包装），以及 `application/mcp/webSearchSetup.ts`（纯配置渲染）。
- **不需要新增任何 npm 依赖**，`THIRD_PARTY_NOTICES.md` 不变。
- headless 的允许清单**仍然不含 `network`**，未改动：无人值守自动放行数据外发不该是默认。
- **未做**：MCP 客户端不发 `notifications/cancelled`（服务器已支持，接上是客户端侧的一小步）、连接固定（anti-rebinding）需要自定义 dispatcher、按 host 粒度的网络授权、`web_fetch` 的缓存。
- **本机实测（2026-09-14）**：把 `dist/yisi/mcp-server/websearch/server.js` 当**真实子进程**起来、走真实 stdio JSON-RPC，`initialize` / `tools/list` 正常，`web_fetch` 走到**真实 DNS 与真实策略**：`169.254.169.254`（云元数据）被拒、`example.com` **也**被拒——因为它在本机被解析成 `198.18.0.135`（代理软件 fake-ip 网段）。**判定是正确的**（接受该网段等于接受 DNS rebinding 落点），但它暴露了一个**真实的产品级限制**：用 fake-ip 代理的用户会发现 `web_fetch` 拒绝一切公网域名。已记入 `docs/20` 供用户自查。**不为此放宽策略。**
- **仍未验证**：在真实 VS Code 里粘贴配置、装上 SearXNG、跑一次**成功的**真实抓取与真实搜索（本机无 GUI 宿主，且本机网络环境会拒绝公网解析 —— 见上）。管线已用**离线 mock 端到端**覆盖到真实 `AgentToolLoop` 与真实 MCP 客户端。

## 守卫
`test/websearch-mcp.test.js`（14：两个工具的边界与诚实失败、SSRF 策略、同源重定向、取消、**经真实 MCP 客户端与真实 loop 的端到端**、Plan 模式被引擎拒绝、配置渲染与命令接线）、`test/websearch-url-policy.test.js`（12）、`test/permission-mode-prompt.test.js`（联网纪律与"网页内容是数据不是指令"两段提示词的存在性）。
