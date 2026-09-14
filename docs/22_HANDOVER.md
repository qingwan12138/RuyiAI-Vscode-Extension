# 22 — 项目交接文档（Handover）

- **交接文档最近更新**：2026-09-14（本仓当前 HEAD）
- **项目**：Yisi AI — 面向 RuyiSDK / RISC-V 的 VS Code Coding Agent（闭源横向项目）
- **当前分支**：`main`（与 `origin/main` 同步；`origin` = `https://github.com/qingwan12138/RuyiAI-Vscode-Extension.git`）
- **验证状态**：`npm run compile` 通过；全量测试 **701 tests / 700 pass / 0 fail / 1 skip**（1 skip = Windows symlink 用例）
- **构建产物**：`yisi-ai-dev-starter-0.1.7.vsix`（≈7.6 MB，含捆绑的运行时依赖）；`.vsix`/`dist`/`node_modules` 均被 gitignore，**不在版本库中**

> **权威来源**（本文档只做索引与坑清单，不重复细节）：
> - 计划与 DoD、逐里程碑实现状态：`docs/12_ROADMAP_AND_DOD.md`
> - 兼容矩阵、测试矩阵、**当前测试数**：`docs/18_COMPATIBILITY_MATRIX.md`
> - 架构决定（ADR-0001…0013）：`docs/decisions/`
> - 强制规则（所有改动前必读）：`AGENTS.md`
> - 合同对账与逐条状态流水（最详细）：`docs/22_CONTRACT_GAP_ANALYSIS.md`
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
| `src/yisi/infrastructure/` | 适配器：llm（OpenAI 兼容/Anthropic）、persistence、process、context、git、attachment（pdf/docx/xlsx/pptx）、mcp（stdio）、hooks |
| `src/yisi/vscode/` | VS Code 适配：provider 向导、workspace/附件选择、diagnostics、symbols、审批桥、plan 文档、proposal diff、secret store |
| `src/yisi/ui/` | Webview：HTML/脚本、协议、协调器、批准桥、Markdown |
| `src/yisi/headless/` | **无编辑器的运行入口**（`runHeadlessTask` + CLI），CI 与 SDK 的地基 |
| `test/` | 全部单测 + e2e（`node --test`）；fixture 在 `test/fixtures/`，helper 在 `test/support/` |

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
| **v0.13 重工程层** | ✅ 三项落地 | ①**联网搜索/抓取已落地**（内置 MCP 服务器，ADR-0013；后端走用户自建 SearXNG，无采购、无备案问题）②**Headless/CI 入口已落地**（ADR-0012）；③云任务、④SDK 对外契约未做（按当前"就是一个 VS Code 扩展"的范围决定不做） |
| v1.0 Delivery | ✅ 本机项 | VSIX 打包 + docs/20 + NOTICE + schema 冻结；**正式发布需目标环境** |

**Agent 工具（25 个内置 + 动态 MCP）**
- 只读：`read_file` `list_directory` `search_text` `repo_index` `inspect_project` `list_symbols` `ruyi_check` `ruyi_workflow` `plan_todo` `session_history` `model_capabilities` `git_status` `git_worktree`(list) `skill`
- 写/执行（权限门）：`replace_text` `create_text_file` `rewrite_text_file` `delete_file` `rename_file` `create_directory` `undo_last_edit`（workspaceWrite）、`run_command` `run_validations` `git_worktree`(remove)（processExec）、`ruyi_manage`（environmentChange）
- loop 拦截（不是普通执行体）：`request_permission`（一次性升级 = Plan 的被审阅退出）、`task`（只读子代理）
- **动态（MCP）**：`mcp__<server>__<tool>`。内置的联网服务器贡献两个 —— `mcp__websearch__web_search`、`mcp__websearch__web_fetch`，风险都是 **`network`**（Plan 拒绝 / 其余模式询问 / Full Access 放行）；未分类的外部工具默认 `environmentChange` + `mutatesWorkspace: true`。
- 动态：`mcp__<server>__<tool>`（由 `yisiAI.mcpServers` 配置的服务器贡献）

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
10. **联网搜索**（ADR-0013 / ADR-0014）：交付形态是**内置 MCP 服务器**（`mcp__websearch__web_search` / `web_fetch`），风险声明为 **`network`**，因此**逐次过 `PermissionEngine`**（Plan 拒绝 / 其余模式询问）。后端两种：用户自建 **SearXNG**，或**模型端点自带的服务端搜索**（零配置，一次搜索 = 一次模型调用）。**不变式**：服务端搜索**必须**走 `SearchBackend`（客户端工具），**禁止**做成"对话内的服务端工具"——那会绕过引擎，Plan 拦不住、卡片不出现。**禁止**为此换成 `AnthropicProvider`（`toolCalling: false`，会让 agent 失去全部工具）。

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

---

## 5. 本地构建 / 测试 / 打包

```bash
npm ci                 # 按 package-lock 安装
npm run compile        # tsc -> dist/（npm run check 只做类型检查）
npm test               # 全量：659 tests / 658 pass / 0 fail / 1 skip
npx vsce package --no-yarn   # 产出 yisi-ai-dev-starter-0.1.7.vsix
```

**DoD 快速验证**
```bash
node --test test/agent-loop-e2e.test.js                # v0.2：定位→提议→Manual 批准→真实验证
node --test test/agent-loop-fix-iteration.e2e.test.js  # v0.3：失败→修复→再验证通过
node --test test/session-isolation.test.js             # v0.4：两写会话隔离、主树不变
node --test test/mcp-stdio-transport.test.js           # MCP：真实子进程 + 取消 + 回收
node --test test/headless.test.js                      # CI：默认只读、opt-in 后真实写盘
```

开发调试：`.vscode/launch.json` → F5 启动 Extension Development Host，随后 **Open Folder 恰好一个本地文件夹**（多根/无 folder 会禁用 Agent 工具）。

> **测试基础设施注意**：agent-loop 的两个 e2e 会**改文件**，因此现在跑在**各自的临时 fixture 副本**上（`test/support/fixtureCopy.js`），不再改动仓库工作树——这是 2026-09-14 修掉的并发竞态根因。

---

## 6. 未完成 / 环境依赖（如实）

| 项 | 阻塞原因 | 需要什么 |
| --- | --- | --- |
| **联网搜索/抓取（v0.13-①）** | **代码已落地**（ADR-0013）；**实网未验证**：本机无 VS Code GUI 宿主，也没有跑起来的 SearXNG | 在真机粘贴配置 + 起一个 SearXNG，跑一次真实搜索 |
| **MCP 客户端不发 `notifications/cancelled`** | 服务器侧已支持（`test/websearch-mcp.test.js` 有用例）；客户端只停止等待，上游请求在它自己的超时处才结束 | 客户端侧的一小步（传输层改动） |
| **联网工具的 `web_fetch` 连接未固定** | 校验解析结果后仍按主机名请求，存在 DNS TOCTOU 窗口；钉住需要自定义 dispatcher | 明确接受该风险或引入 dispatcher |
| **MCP 条目不支持 `env`** | 刻意不做（一旦支持，`settings.json` 就会变成放 token 的地方，违反 MCP rule） | 若确需，需先设计"只允许非机密值"的约束 |
| **云任务交接 / SDK 对外契约（v0.13-③④）** | 按当前范围决定**不做**（这就是一个 VS Code 扩展）；没有远端服务也没有外部消费者，现在做等于凭空发明契约（违反 `AGENTS.md §5`） | 真实的后端/调用方 |
| v0.8 合并进上游 + 原 RuyiSDK regression + one VSIX | 本机无上游仓库/凭据 | 上游仓库访问权 + 能开 PR 的环境 |
| v0.6 真实 Ruyi/RISC-V 端到端 workflow | 开发机为 Windows、未装 ruyi | 一台 Linux + RuyiSDK 机器 |
| v1.0 正式发布（LNX-001..020 smoke、最终 release） | 需目标 Linux/发布环境 | 目标环境 + 发布流程 |
| v0.1 真实云账号联网人工验收 | 需账号/网络 | 可用的 Provider 账号 |
| VSIX **完整 bundle 化** | 引入 esbuild 需处理 mammoth/pdfjs 的**懒加载动态 require**，静态打包有破坏风险 | 明确接受该风险 |
| 检查点**持久化** | 与"会话只存引用不存内容"原则冲突，需设计 sidecar 及其生命周期 | 独立设计 |
| diff 内**编辑提案**后再批准 | 要求编辑路径在**应用时**读取提案内容，会动到 stale guard 边界 | 独立设计 |
| Ruyi 面板的变更操作按钮 | 属可选增强 | 需求确认 |

**未跟踪文件**：`random.js`、`gen_random_numbers.js`（不在版本库，打包已排除）。

---

## 7. 下一步建议（优先级）

1. **要真机验收**：联网已可用（ADR-0013）——在真机粘贴 `yisiAI.mcpServers` 条目、起一个 SearXNG，确认 `web_search` 真的返回结果且审批卡片标注 `network`。这是唯一还没被验证过的一环。
2. **要环境**：上游仓库 → v0.8；Linux + RuyiSDK → v0.6 与 LNX smoke。
3. **要真实需求**：云任务/SDK 对外契约——按当前范围决定不做，等有后端或外部调用方再议。
4. 不阻塞的小事：VSIX bundle 化、检查点持久化、diff 内编辑提案、Ruyi 面板变更按钮、MCP 客户端的取消通知。

---

## 8. 交接清单

- [x] 计划书与 DoD：`docs/12`
- [x] 完成报告（历史快照）：`docs/21`
- [x] 兼容矩阵 / 测试矩阵 / 环境依赖清单：`docs/18`
- [x] 安装/使用/维护/升级 + CI 用法：`docs/20`
- [x] 架构决定：`docs/decisions/ADR-0001…0012`
- [x] 强制规则：`AGENTS.md`
- [x] 第三方 NOTICE：`THIRD_PARTY_NOTICES.md`（由 `test/dependency-notices.test.js` 守卫）
- [x] 全量测试可跑通：**659/658/0**（1 skip = Windows symlink）
- [x] 当前数字跨文档一致：由 `test/docs-consistency.test.js` 守卫
- [ ] 上游合并 / 正式发布（见 §6，需环境）
