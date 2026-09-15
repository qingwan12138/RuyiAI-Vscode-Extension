# 22 — 项目交接文档（Handover）

- **交接文档最近更新**：2026-09-14。**测试数字不是手写的**：由 `test/docs-consistency.test.js` 强制本文档、`docs/18` 与 `docs/12` 最新一条里程碑证据三者一致，改一处不改另两处会直接失败。
- **项目**：Yisi AI — 面向 RuyiSDK / RISC-V 的 VS Code Coding Agent（闭源横向项目）
- **当前分支**：`main`（与 `origin/main` 同步；`origin` = `https://github.com/qingwan12138/RuyiAI-Vscode-Extension.git`）
- **验证状态**：`npm run compile` 通过；全量测试 **704 tests / 703 pass / 0 fail / 1 skip**（1 skip = Windows symlink 用例）
- **构建产物**：`yisi-ai-dev-starter-0.1.7.vsix`（≈7.6 MB，含捆绑的运行时依赖）；`.vsix`/`dist`/`node_modules` 均被 gitignore，**不在版本库中**

> **权威来源**（本文档只做索引与坑清单，不重复细节）：
> - 计划与 DoD、逐里程碑实现状态：`docs/12_ROADMAP_AND_DOD.md`
> - 兼容矩阵、测试矩阵、**当前测试数**：`docs/18_COMPATIBILITY_MATRIX.md`
> - 架构决定（ADR-0001…0014）：`docs/decisions/`
> - 强制规则（所有改动前必读）：`AGENTS.md`
> - 合同对账与逐条状态流水（最详细）：`docs/22_CONTRACT_GAP_ANALYSIS.md`
> - 联网能力：实现报告 `docs/23_WEB_SEARCH_IMPLEMENTATION_REPORT.md`（30 问）+ 后端重构说明 `docs/24_WEB_SEARCH_BACKEND_REFACTOR.md`
>
> 历史快照（数字当日有效，勿当现状）：`docs/21_COMPLETED_WORK_REPORT.md`、`docs/22_HANDOVER.md` 的旧版本内容。

---

## 1. 项目目标与交付形态

- **产品定位**：RuyiSDK / RISC-V 场景下的 VS Code Coding Agent（能读/改/跑/验证工作区代码，并具备 Ruyi 感知）。
- **最终交付形态**：**一个 VSIX**（上游 `ruyisdk-vscode-extension` 能力 + 内嵌闭源 Yisi AI 模块）。
- **正式运行环境**：**Linux 本机 VS Code**（docs/16）。保留 `ExecutionWorkspace` / `PlatformAdapter` / `ProcessRunner` / `GitPort` / `RuyiPort` 抽象，但**当前不实现 Remote-SSH**。
- **自研语言约束**：TypeScript / JavaScript（优先 TS）；允许经 Port/Adapter/Process 调用 `ruyi`、`git`、`gcc/clang`、`cmake`、MCP 服务器等外部工具；**默认禁止 native addon / 第二套运行时**（docs/17）。

---

## 2. 架构与分层契约

```
ui  ->  application  ->  domain
infrastructure  ->  domain ports
```

- domain 不依赖 vscode、具体 LLM SDK/数据库/上游 UI；Webview 与宿主之间只经 **typed protocol**。
- **绝不让 LLM 决定是否绕过 Permission Engine**：每次工具调用逐次过引擎（ADR 与 `AGENTS.md` 多处锁定）。
- 禁止 fork/复制开源 Coding Agent 代码；参考项目只学**行为与思想**（docs/04）。

| 路径 | 职责 |
| --- | --- |
| `src/yisi/index.ts` | 扩展激活与**组装层**（装配 session/provider/chat/工具/视图，注册命令） |
| `src/yisi/domain/` | 纯领域：session、tool、process、gitPort、worktreePort、mcpPort、hookPort、模型能力/窗口表、permissionMode |
| `src/yisi/application/` | 用例：chat、agent（loop/runner/registry/plan/审批/子代理）、edit（含 journal 与检查点）、process、validation、context、skills、hooks、mcp、ruyi、git、workspace、security |
| `src/yisi/infrastructure/` | 适配器：llm（**OpenAI 兼容**＝agent 路径 / Anthropic＝仅文本流式）、persistence、process、context、git、attachment（pdf/docx/xlsx/pptx）、mcp（stdio）、hooks |
| `src/yisi/mcp-server/websearch/` | **随扩展分发的联网 MCP 服务器**（自带，不是用户配置的第三方服务器）：`urlPolicy`（SSRF 策略）、`webTools`（两个工具 + SearXNG 后端）、`nativeSearchBackend`（服务端搜索后端）、`server`（协议层 + stdio + 后端选择） |
| `src/yisi/vscode/` | VS Code 适配：provider 向导、workspace/附件选择、diagnostics、symbols、审批桥、plan 文档、proposal diff、secret store |
| `src/yisi/ui/` | Webview：HTML/脚本、协议、协调器、批准桥、Markdown |
| `src/yisi/headless/` | **无编辑器的运行入口**（`runHeadlessTask` + CLI），CI 与 SDK 的地基 |
| `test/` | 全部单测 + e2e（`node --test`）；fixture 在 `test/fixtures/`，helper 在 `test/support/`（含 `fixtureCopy.js`、**`tempDir.js`**） |
| `scripts/` | 一次性验证脚本（如 `probe-native-search.js`） |

---

## 3. 完成情况（对照 docs/12）

| 版本 | 状态 | 说明与证据 |
| --- | --- | --- |
| v0.1 Foundation | ✅ | 激活/会话持久化/SecretStorage/Provider 配置/SSE 流式 |
| v0.2 Coding Agent MVP | ✅ DoD | 工具 + Agent loop + PermissionEngine；e2e `agent-loop-e2e.test.js` |
| v0.3 Reliable Editing | ✅ DoD | 编辑全套 + stale guard + diff 批准 + undo/Journal；e2e `agent-loop-fix-iteration.e2e.test.js` |
| v0.4 Git / 并行会话 | ✅ DoD | `git_status`/`git_worktree` + dirty 保护 + 写会话 worktree 隔离 |
| v0.5 Ruyi Typed Tools | ✅ 核心 | 全 `--porcelain`（从不解析人类 CLI 文本）+ `ruyi_manage` + Ruyi popover |
| v0.6 Ruyi Workflow | ⚠️ 前置规划✅ | `ruyi_workflow` 就绪度报告；**端到端 DoD 需真实 Ruyi 环境** |
| v0.7 Context & Mature Agent | ✅ DoD | 压缩/`historyBudgetRatio`/`repo_index`/`plan_todo`/能力降级/`session_history`；**压缩窗口现与上下文环同源** |
| v0.8 Upstream Integration | ⛔ **环境依赖** | 需上游仓库访问权 |
| v0.9 RC | ✅ 代码级 | 密钥脱敏 + 依赖/许可守卫 + schema 守卫 + 性能基线 + 兼容矩阵 |
| v0.10 CC-style sidebar | ✅ | 侧栏顶部不再有重复产品标题行 |
| **v0.11 扩展层** | ✅ **四项全部落地** | ①项目指令文件（ADR-0004）②MCP 客户端（ADR-0005）③Hooks（ADR-0006）④Skills（ADR-0007） |
| **v0.12 编排与体验层** | ✅ **四项全部落地** | ①Subagents（ADR-0008）②Checkpoints/rewind（ADR-0009）③并排 diff（ADR-0010）④Plan 文档化审阅（ADR-0011） |
| **v0.13 重工程层** | ✅ 三项落地 | ①**联网搜索/抓取已落地**：随扩展分发的 MCP 服务器（ADR-0013），后端两种 —— 用户自建 SearXNG，或**模型端点自带的服务端搜索**（ADR-0014，零配置）。**无采购、无备案、无新增 npm 依赖**。②**Headless/CI 入口已落地**（ADR-0012）③云任务、④SDK 对外契约**按范围决定不做** |
| v1.0 Delivery | ✅ 本机项 | VSIX 打包 + docs/20 + NOTICE + schema 冻结；**正式发布需目标环境** |

**Agent 工具（25 个内置 + 动态 MCP）**
- 只读：`read_file` `list_directory` `search_text` `repo_index` `inspect_project` `list_symbols` `ruyi_check` `ruyi_workflow` `plan_todo` `session_history` `model_capabilities` `git_status` `git_worktree`(list) `skill`
- 写/执行（权限门）：`replace_text` `create_text_file` `rewrite_text_file` `delete_file` `rename_file` `create_directory` `undo_last_edit`（workspaceWrite）、`run_command` `run_validations` `git_worktree`(remove)（processExec）、`ruyi_manage`（environmentChange）
- loop 拦截（不是普通执行体）：`request_permission`（一次性升级 = Plan 的被审阅退出）、`task`（只读子代理）
- **动态（MCP）**：`mcp__<server>__<tool>`。**随扩展自带的联网服务器贡献两个** —— `mcp__websearch__web_search`、`mcp__websearch__web_fetch`，风险都是 **`network`**（Plan 拒绝 / 其余模式询问 / Full Access 放行）。未分类的外部工具默认 `environmentChange` + `mutatesWorkspace: true`。

---

## 4. 关键设计决策与已知坑（接手必读）

### 4.1 由 ADR 锁定的不变式（改动前先读对应 ADR）
1. **项目指令文件**（ADR-0004）：`AGENTS.md` > `CLAUDE.md` > `YISI.md`，**先命中者生效**，作为请求头部第二条 system 消息；**是工作区内容，不能改变权限规则**；失败不得致命。
2. **MCP**（ADR-0005）：工具 id 固定 `mcp__<server>__<tool>`（`mcp__` 保留，防遮蔽内置工具）；**未分类工具默认 `environmentChange` + `mutatesWorkspace: true`**（Plan 拒绝/其余询问/FullAccess 放行）；`destructive`/`credentialSensitive` **不允许声明**；失败降级为零工具；随扩展回收子进程。
3. **Hooks**（ADR-0006）：`preToolUse`（跑在权限判定**之前**，可拒绝）/`postToolUse`（输出附加到工具结果）。**hook 只能收紧**——决策只有 `allow`/`deny`，没有"批准"这个值，`allow` 也不跳过引擎与审批卡片。**hook 拒绝是独立理由 `hook` 且不计入 `policyDenials`**（放宽模式解不开它）。
4. **Skills**（ADR-0007）：`.yisi/skills/`；**描述常驻（≤240/条、≤4000/块）、正文按需（≤16000）**；`/name` 的正文**只进入本轮，会话只存用户原话**；`skill` 工具只接受名称。
5. **Subagents**（ADR-0008）：`task` 派**只读**子代理，工具集被过滤（`readOnly && !mutates && !escalation && !subagent`）；**只回 `report`**；继承父模式与 hooks；≤4 个/运行、≤6 轮/个、串行、Stop 传播。
6. **Checkpoints**（ADR-0009）：回到检查点 K = 撤销 **K 及其之后**；逆操作走写入端口因而**继承 stale guard**（用户改过的文件被拒绝，绝不覆盖）；**只有全部成功才忘记检查点**；检查点**在内存**，不进会话文档。
7. **并排 diff**（ADR-0010）：**是视图不是审批通道**（presenter 拿不到 `ApprovalBroker`）；**推演不可信就跳过**（不再唯一匹配/读不到/超 512KB），绝不显示不会真正发生的"未来"。
8. **Plan 审阅**（ADR-0011）：计划渲染成**可编辑文档**，用户改动作为**反馈**回传（批准与拒绝都回）；反馈只回**被改动的行**；`confirm` 可返回 `boolean | {approved, feedback?}`。
9. **Headless**（ADR-0012）：**默认只读（plan，无审批通道）**；`--allow-write` 显式 opt-in（转 `manual`）；**`destructive`/`credentialSensitive` 永远无通道**；密钥只从环境变量读；退出码 0/1/2。
10. **联网搜索**（ADR-0013 / ADR-0014）：交付形态是**随扩展分发的 MCP 服务器**（`mcp__websearch__web_search` / `web_fetch`），风险声明为 **`network`**，因此**逐次过 `PermissionEngine`**（Plan 拒绝 / 其余模式询问）。后端两种：用户自建 **SearXNG**，或**模型端点自带的服务端搜索**（零配置，一次搜索 = 一次模型调用）。**三条不变式**：①服务端搜索**必须**走 `SearchBackend`（客户端工具），**禁止**做成"对话内的服务端工具"——那会绕过引擎，Plan 拦不住、卡片不出现；②**禁止**为此把聊天 provider 换成 `AnthropicProvider`（`toolCalling: false`，会让 agent 失去**全部**工具、退化成聊天框）；③native 后端**只信结构化块**，没有搜索块**必须报错**，不得当成空结果。

### 4.2 历史坑（仍然有效，别再踩）
1. **PDF**：`pdfjs-dist@4.10.38`，安全下限 `>=4.2.67`（CVE-2024-4367），**不要回退 3.x**；4.x 为 ESM-only，必须真实动态 `import()` + 设 `workerSrc` + 预载 `globalThis.pdfjsWorker`；5.x/6.x 需 Node ≥22.13，宿主是 Node 20.18.1。守卫：`test/pdf-real-extractor.test.js`。
2. **错误可见性**：`sessionError` 必须在 `publishState` **之后**发出，否则 Webview 重建会话会把错误清掉（表现为"Thinking… 后无下文"）。
3. **"文本 + 工具调用"同轮**：DeepSeek 等合法地在同一轮返回前言 + tool_calls，传输层与 loop 都已接受，**不要恢复成报错**。
4. **Manual/Auto 确认**：`toolConfirmationSummary` 必须覆盖**所有**需确认工具，否则会静默拒绝并整轮 blocked。
5. **写 session 隔离**：只在 git 仓库做 worktree；创建失败必须**优雅降级**为共享工作区。
6. **会话自动命名**：**不要加 `maxTokens`**（思考模式会吃光导致永远 "New Chat"）；失败必须留日志；用户改过的名字永不被覆盖；只命名一次。
7. **思考轨迹**：`reasoningDelta` 只用于显示——**绝不进入 `messages`、绝不持久化、不回传宿主**；provider **不得**把 `reasoning_content` 计入 `emitted`。
8. **Webview 内联脚本**：`chatViewHtml.ts` 里每个反斜杠都要写成**双份**，否则整个客户端脚本语法错误、页面渲染但**点击全部无响应**（发生过）。改脚本必须跑 `test/chat-view-source.test.js`。
9. **不要默认读 `.gitignore` 内容**（用户显式引用除外）；**不要自动恢复** VS Code 关闭前的长进程（只能记录并让用户 Resume）。
10. **测试临时目录**：建系统临时目录**必须**走 `test/support/tempDir.js`（创建即注册、进程退出时同步清理），**禁止**直接 `fs.mkdtemp*`。曾经两个测试文件建了不清理，机器上累积到 **327 个**（119 个非空）才被发现——**泄漏不会让任何断言失败**，只能靠守卫抓。守卫：`test/temp-dir-hygiene.test.js`（源码扫描 + **真实子进程退出后目录必须消失**）。
11. **MCP 条目不支持 `env`**：刻意的——一旦支持，`settings.json` 就会变成放 token 的地方。服务器配置只能经环境变量（详见 §5）。
12. **fake-ip 代理会让 `web_fetch` 拒绝一切公网域名**（Clash 类默认 `198.18.0.0/15`，本机实测 `example.com` → `198.18.0.135`）。判定是**对的**（接受该网段等于接受 DNS rebinding 落点），**不要为此放宽策略**——要改的是环境。

---

## 5. 本地构建 / 测试 / 打包

```bash
npm ci                 # 按 package-lock 安装
npm run compile        # tsc -> dist/（npm run check 只做类型检查）
npm test               # 全量：704 tests / 703 pass / 0 fail / 1 skip
npx vsce package --no-yarn   # 产出 yisi-ai-dev-starter-0.1.7.vsix
```

**DoD 快速验证**
```bash
node --test test/agent-loop-e2e.test.js                # v0.2：定位→提议→Manual 批准→真实验证
node --test test/agent-loop-fix-iteration.e2e.test.js  # v0.3：失败→修复→再验证通过
node --test test/session-isolation.test.js             # v0.4：两写会话隔离、主树不变
node --test test/mcp-stdio-transport.test.js           # MCP：真实子进程 + 取消 + 回收
node --test test/headless.test.js                      # CI：默认只读、opt-in 后真实写盘
node --test test/websearch-mcp.test.js                 # 联网：真实 loop + 真实 MCP 客户端（离线）
node --test test/temp-dir-hygiene.test.js              # 测试不再往机器上倒临时目录
```

开发调试：`.vscode/launch.json` → F5 启动 Extension Development Host，随后 **Open Folder 恰好一个本地文件夹**（多根/无 folder 会禁用 Agent 工具）。

### 5.1 开启联网搜索（两步，只做一次）

**provider 不用改**。第一个可用路径是**零配置**的：

```bash
export DEEPSEEK_API_KEY=sk-...      # 从该 shell 启动 code，让扩展宿主继承它
npm run websearch:probe -- "ruyisdk latest release"   # 一条命令验证端点是否支持服务端搜索
```

探针退出码 **0 = 真的搜到了 / 1 = 没搜到 / 2 = 没给 key**；失败时**原样打印服务商自己的错误**。通了就不用再配置任何东西。

- **后端优先级**（`resolveSearchBackend`，显式胜过隐式）：`YISI_SEARCH_BACKEND`（`auto|searxng|native|none`）> `YISI_SEARXNG_URL` > 模型 key。
- 可覆盖项：`YISI_SEARCH_BASE_URL`（默认 `https://api.deepseek.com/anthropic`）、`YISI_SEARCH_MODEL`（默认 `deepseek-flash`）、`YISI_SEARCH_TOOL`（默认 `web_search_20250305`）、`YISI_SEARCH_API_KEY`。**模型 id 与工具类型都会漂，失败信息会点名该改哪个变量。**
- 命令面板 **`Yisi AI: Copy Web Search (MCP) Configuration`** 把含**真实安装路径**的 `yisiAI.mcpServers` 条目复制到剪贴板（扩展装在带版本号的目录里，路径只能运行时求值）。
- **不想用 native**：设 `YISI_SEARCH_BACKEND=searxng` + `YISI_SEARXNG_URL`（自建 SearXNG，完全不花钱）；或 `none` 关掉搜索（`web_fetch` 仍可用）。
- **key 只从环境读**，不打印（日志与错误消息都脱敏，有测试锁定）。

> **测试基础设施注意**：agent-loop 的两个 e2e 会**改文件**，因此跑在**各自的临时 fixture 副本**上（`test/support/fixtureCopy.js`），不再改动仓库工作树——这是 2026-09-14 修掉的并发竞态根因。同理，所有系统临时目录现在都走 `test/support/tempDir.js`。

---

## 6. 未完成 / 环境依赖（如实）

| 项 | 阻塞原因 | 需要什么 |
| --- | --- | --- |
| **联网搜索的真机验收** | **代码已落地**（ADR-0013 / ADR-0014）；**真 key 与真 GUI 未验证**：本机无 VS Code GUI 宿主，且本机网络环境（fake-ip 代理）会拒绝公网解析 | `export DEEPSEEK_API_KEY` 后跑 `npm run websearch:probe`；再在真机确认 `web_search` 返回结果且审批卡片标注 `network` |
| **`web_fetch` 未做过的成功抓取** | 本机 DNS 把公网域名解析成 `198.18.x.x`（代理 fake-ip），策略**正确地**拒绝 | 关掉 fake-ip 或换一台机器抓一次 |
| **MCP 客户端不发 `notifications/cancelled`** | 服务器侧已支持（`test/websearch-mcp.test.js` 有用例）；客户端只停止等待，上游请求在它自己的超时处才结束 | 客户端侧的一小步（传输层改动） |
| **`web_fetch` 连接未固定** | 校验解析结果后仍按主机名请求，存在 DNS TOCTOU 窗口；钉住需要自定义 dispatcher | 明确接受该风险或引入 dispatcher |
| **MCP 条目不支持 `env`** | 刻意不做（见 §4.2-11） | 若确需，需先设计"只允许非机密值"的约束 |
| **不把 SecretStorage 的 key 注入 MCP 子进程** | 这是一条**新的秘密流向**，与"秘密只进用户的 shell/环境"相抵触 | 独立 ADR |
| **云任务交接 / SDK 对外契约（v0.13-③④）** | 按当前范围决定**不做**（这就是一个 VS Code 扩展）；没有远端服务也没有外部消费者，现在做等于凭空发明契约（违反 `AGENTS.md §5`） | 真实的后端/调用方 |
| v0.8 合并进上游 + 原 RuyiSDK regression + one VSIX | 本机无上游仓库/凭据 | 上游仓库访问权 + 能开 PR 的环境 |
| v0.6 真实 Ruyi/RISC-V 端到端 workflow | 开发机为 Windows、未装 ruyi | 一台 Linux + RuyiSDK 机器 |
| v1.0 正式发布（LNX-001..020 smoke、最终 release） | 需目标 Linux/发布环境 | 目标环境 + 发布流程 |
| v0.1 真实云账号人工验收 | 需账号/网络 | 可用的 Provider 账号 |
| VSIX **完整 bundle 化** | 引入 esbuild 需处理 mammoth/pdfjs 的**懒加载动态 require**，静态打包有破坏风险 | 明确接受该风险 |
| 检查点**持久化** | 与"会话只存引用不存内容"原则冲突，需设计 sidecar 及其生命周期 | 独立设计 |
| diff 内**编辑提案**后再批准 | 要求编辑路径在**应用时**读取提案内容，会动到 stale guard 边界 | 独立设计 |
| Ruyi 面板的变更操作按钮 | 属可选增强 | 需求确认 |

**未跟踪文件**：无。此前记录的 `random.js` / `gen_random_numbers.js` 已不在工作区（`Test-Path` 两条均为 false）；`dist/`（构建产物，`npm run compile` 可再生）与 `node_modules/`（依赖）按设计不入库。

**本地残留**：目录已清理为 0，且**不会再新增**——测试临时目录泄漏已修（§4.2-10）。实测：全量跑一遍前后 **327 → 327，新增 0**。

---

## 7. 下一步建议（优先级）

1. **要真机验收（唯一没验证过的一环）**：`export DEEPSEEK_API_KEY` → `npm run websearch:probe -- "关键词"` → 在真 VS Code 里让我查个东西，确认返回结果且审批卡片标注 `network`。这一步只能由你完成，我这边没有 GUI 宿主、也没有 key。
2. **要环境**：上游仓库 → v0.8；Linux + RuyiSDK → v0.6 与 LNX smoke。
3. **要真实需求**：云任务/SDK 对外契约——按当前范围决定不做，等有后端或外部调用方再议。
4. 不阻塞的小事：VSIX bundle 化、检查点持久化、diff 内编辑提案、Ruyi 面板变更按钮、MCP 客户端的取消通知、`web_fetch` 连接固定。

---

## 8. 交接清单

- [x] 计划书与 DoD：`docs/12`
- [x] 完成报告（历史快照）：`docs/21`
- [x] 兼容矩阵 / 测试矩阵 / 环境依赖清单：`docs/18`
- [x] 安装/使用/维护/升级 + CI 用法 + **联网开启步骤**：`docs/20`
- [x] 联网实现报告（30 问）与后端重构说明：`docs/23`、`docs/24`
- [x] 架构决定：`docs/decisions/ADR-0001…0014`
- [x] 强制规则：`AGENTS.md`（含 Web search rule、Test temp-directory rule）
- [x] 第三方 NOTICE：`THIRD_PARTY_NOTICES.md`（由 `test/dependency-notices.test.js` 守卫）——**联网没有新增任何运行时依赖**
- [x] 全量测试可跑通：**704/703/0**（1 skip = Windows symlink）
- [x] 当前数字跨文档一致：由 `test/docs-consistency.test.js` 守卫
- [ ] 联网真机验收（§6，需你的 key 与 GUI）
- [ ] 上游合并 / 正式发布（§6，需环境）
