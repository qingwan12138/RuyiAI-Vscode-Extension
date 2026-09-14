# 12 — Roadmap & Definition of Done

## v0.1 Foundation / Chat Vertical Slice
- activation + sidebar/webview typed protocol
- local Session persistence + migrations
- provider settings wizard + SecretStorage/env
- OpenAI-compatible adapter（覆盖 llama.cpp server）+ 至少一个云 provider
- streaming chat + model/session persistence
DoD：重启 VS Code 会话可恢复；secret 不落普通存储；fake provider 测试通过。

当前实现状态（2026-08-30）：代码基线已覆盖以上条目。自动化测试覆盖 Session 恢复、SecretStorage 与普通状态隔离、Provider 配置、模型发现、SSE 分片、失败/取消、最终回复持久化和 Webview 运行状态；真实云账号联网与人工 Extension Development Host 视觉验收仍作为环境相关验收记录，不扩张为已完成 Agent 能力。

## v0.2 Coding Agent MVP
- Read/List/Search/Selection/@file/@folder scope/@symbol
- Agent loop + tool schema + PermissionEngine Plan/Manual
- ProcessRunner + Diagnostics
DoD：fixture repo 可完成“定位 → 修改 proposal → 用户批准 → 验证”的端到端任务。

当前实现状态（2026-08-31，部分）：已实现受限 Read/List/Search/唯一文本替换/排他式文本文件创建、canonical workspace/symlink 边界、常见凭据文件的隐式搜索/Agent 读写排除、显式文件上下文附加、统一风险类型的 Permission Engine，以及结构化 ProcessRunner、VS Code Diagnostics 快照与顺序 ValidationEngine。进程执行使用 `shell:false` 的精确 argv，stdout/stderr 独立限量，支持超时/取消；Linux 使用受控进程组 SIGTERM → grace → SIGKILL。新建 Provider 可显式启用 OpenAI-compatible 结构化 Agent tool loop；单一本地工作区的 Composer 已接通工具 schema、逐次权限判定、结果回传、取消与循环保护，旧配置迁移为关闭。替换要求 read 返回的 SHA-256、唯一匹配与原子同目录发布；创建只允许已有目录内的新 UTF-8 文件并拒绝覆盖。Plan 拒绝，Manual 使用 Extension Host 原生确认，Session 权限选择器已接通。成功写入会返回有界的即时 workspace diagnostics 快照；不可用时明确标记，且不把快照宣称为语言服务刷新完成或验证通过。

更新（2026-09-03）：工具集已远超 v0.2：新增删除/重命名/建目录/整文件重写（agent-created + stale guard）、`undo_last_edit` 与 Edit Journal 查看器、`run_command`（processExec 权限门 + 结构化输出摘要）、`inspect_project`（构建/测试框架探测）、`run_validations`（按探测选择并运行验证命令并回喂证据）、`list_symbols`（语言服务器符号）、`ruyi_check`；编辑器右键/命令面板提供选区任务（解释/注释/单测）与项目级文档任务（README/API），PDF 扫描页可转为有界 PNG 供视觉模型。**v0.2 DoD 验证证据**：新增自动化端到端测试 `test/agent-loop-e2e.test.js` + fixture `test/fixtures/agent-loop-demo/`（calc.js 含故意 bug），用脚本化 provider 驱动真实工具链在 fixture 上完成"定位（read_file）→ 修改提议（replace_text，Manual 批准被记录）→ 验证（真实 `node --test` exit 0）→ 总结"，并另测 Plan 模式在工作区写操作执行前拒绝（文件未被创建）。仍在 v0.2 范围外/可选项：@folder 作 UI 范围 chip、@symbol UI 选择器（工具级 `list_symbols` 已具备）、以及使用真实云模型账号的人工联网验收。

## v0.3 Reliable Editing
- patch/edit/create/delete + stale write guard
- diff/accept/reject/undo
- Accept Edits/Auto/Full Access
- validation planner + loop guard + Stop/Continue
DoD：失败测试可自动迭代修复；Stop 不损坏 session；无验证不声称成功。

当前实现状态（2026-09-05，达成）：edit/create/delete/rename/mkdir/rewrite 均由 `WorkspaceEditService` 提供，写入要求 read 返回的 SHA-256 与唯一匹配、原子同目录发布，并带 stale guard 与"仅 agent-created"重写门；`undo_last_edit` + Edit Journal 查看器、`renderTextDiff`。批准前在侧栏卡片内渲染统一 diff（replace/rewrite/create），Approve/拒绝回传。权限模式 acceptEdits / auto / fullAccess 由 `PermissionEngine` 统一分类（acceptEdits/auto 允许 workspace 写、确认 processExec；fullAccess 仅对 destructive/credentialSensitive 保留确认），并经 `test/permission-engine.test.js` 覆盖。ValidationPlanner（`run_validations`，按探测选择命令并回喂证据）+ loop guard（maxRounds/maxCallsPerRound/重复调用/空输出/混合/预算）+ `Stop`/`Continue`、会话 `interrupted` 状态（`chat-service.test.js` 验证中止后不损坏、可恢复）。**v0.3 DoD 验证证据**：新增 `test/agent-loop-fix-iteration.e2e.test.js` + fixture `test/fixtures/agent-loop-fix-demo/`（multiply 故意写成 `a + b`），用真实 `node calc.test.mjs` 证明"**失败测试自动迭代修复**"：read → 首次验证 FAIL（exit≠0）→ 依据 sha 修复 → 再次验证 PASS（exit 0）→ 总结；全程真实工具+真实进程。同时把既有 `agent-loop-e2e.test.js` 的验证也改为直接 `node calc.test.mjs`（避免在 node:test 内嵌套 `--test` 触发"skipping running files"造成假 exit 0）。Stop 不损坏、无验证不声称成功均以此 e2e + 既有测试作为证据。

## v0.4 Git / Parallel Sessions
- git status/diff
- worktree manager + isolated execution workspace
- multi-session process separation
DoD：两个写 session 并行不直接修改同一 working tree；dirty worktree 删除保护。

当前实现状态（2026-09-05，达成）：已实现 `GitPort`（domain）+ `NodeGitService`（infrastructure，经结构化 spawn/git porcelain 解析，`core.quotepath=false` 支持中文/空格路径、非 repo 不抛错）+ **`git_status` 工具**（readOnly，返回 repo/branch/clean/变更文件列表并封顶），并新增 **dirty worktree 删除保护**：`workspaceEditService` 在 delete/rename（及改写）前检查目标路径是否携带**已跟踪的未提交改动**（M/A/D/R/C），是则拒绝并提示 commit/stash；纯 untracked（agent 新建）文件保持可删；非 git 工作区跳过保护（LNX-016）。**`WorktreePort` + `NodeWorktreeManager`**（worktree list/create/remove，porcelain 解析、不假定默认分支、不从 HEAD 之外分支、不直接改 `.git/worktrees` metadata、脏 worktree 无 force 拒绝移除并给恢复提示）+ `WorktreeManagerService.createSessionWorktree`（隔离 worktree，分支 `yisi/session-<id>`）+ **`git_worktree` 工具**（list/remove）。**Per-session 隔离执行已接线（v0.4 DoD）**：`SessionIsolationService` 在写 session（mode ≠ plan）首次运行时为其建立隔离 worktree 并构造绑定该 root 的独立 `AgentChatRunner`（readOnly/plan 会话留在共享工作区用 main runner），`ChatService` 通过 `sessionRunner` 解析器按会话选取 runner；会话 worktree 可 `cleanup` 移除。覆盖：`test/node-git-service.test.js`（porcelain 解析、真实 git repo branch/dirty、非 repo 安全）、`test/workspace-edit-dirty-guard.test.js`（脏拒绝/untracked 放行/重命名拒绝/非 repo 放行）、`test/git-status-tool.test.js`（readOnly、封顶）、`test/node-worktree-manager.test.js`（porcelain 解析、真实创建隔离 worktree 且主树不变、脏移除拒绝/强删、工具元数据）、`test/session-isolation.test.js`（**两个写 session 各自隔离独立 worktree、共享主工作树保持干净、plan 不隔离、cleanup**）、`test/chat-service.test.js`（写会话用 session 级 runner、plan 回退共享 runner）。真实 Linux LNX-015 worktree 隔离 smoke test 仍作为交付验收项（能力已在真实 git repo 上验证）。

## v0.5 Ruyi Typed Tools
- RuyiPort/porcelain parser/package/profile/venv/update/extract 等
- Ruyi operation UI + permission risk
- optional upstream refresh bridge
DoD：不用解析 human CLI 文本完成核心 Ruyi 操作；上游 bridge 缺失不影响核心。

当前实现状态（2026-09-05，达成核心 + 操作 UI 已落地）：`RuyiPort` 扩展为**类型化**操作集（getVersion/listPackages/listProfiles/install/uninstall/**createVenv/removeVenv/createProfile/removeProfile/update/extract**）；`RuyiCliAdapter` 全部通过 `ruyi --porcelain` 并以"每行一个 JSON"解析记录，**从不解析面向人类的 CLI 文本**（docs/16 §12、DoD）；CLI 语法集中在适配器一处。新增 **`ruyi_manage` 工具**（environmentChange 权限门），Agent loop 的 bounded scope 已**接纳 environmentChange**（仅经权限门）。上游 refresh bridge 为可选项、不依赖 → 缺失不影响核心（DoD 满足）。**Ruyi 操作 UI**：侧栏顶栏新增 **Ruyi 按钮 + popover（`ruyiState`）** 实时显示 Ruyi CLI/包/profile 摘要（只读检查面），另有 `Yisi AI: Ruyi Environment Check` 命令弹出摘要；变更类操作仍走 `ruyi_manage` 工具 + 批准卡片。覆盖：`test/ruyi-cli-adapter.test.js`、`test/ruyi-manage-service.test.js`、`test/read-only-agent-loop.test.js`、`test/ruyi-check-command.test.js`（命令声明+注册+provider 表面）、`test/chat-view-source.test.js`（ruyi popover 标记）、`test/webview-protocol.test.js`（ruyiInspect）。**仍待续**：真实 Ruyi CLI/RISC-V fixture 的实机验收（归入 v0.6 DoD 的"至少一个真实 Ruyi/RISC-V fixture"）。

## v0.6 Ruyi Intelligent Workflow
- Board/Profile/Toolchain/Sysroot/Venv/Build workflow
- Ruyi-aware validation / recovery
DoD：至少一个真实 Ruyi/RISC-V fixture 或测试环境完成端到端 workflow。

当前实现状态（2026-09-05，前置规划已落地）：新增 **`RuyiWorkflowService` + `ruyi_workflow` 工具**（readOnly）：基于 `ruyi --porcelain` 数据报告 **Board → Profile → Toolchain → Sysroot → Venv** 的就绪度（ruyi CLI 版本、已装 toolchain 包、profiles、目标 profile 是否已装、sysroot/venv 可否推导）与缺口列表；不猜测 board→toolchain 映射（真实映射属于 Ruyi 设备/领域数据，由真实环境提供），只枚举已装 toolchain 并标记命名缺口，供上层 `ruyi_manage`/`ruyi_check` 决策。覆盖：`test/ruyi-workflow-service.test.js`（就绪报告、缺失 profile/toolchain 标记、ruyi 缺失时安全降级、工具 readOnly 与 target 清洗）。**待续/环境依赖**：真正的端到端 Build/validate 及 Ruyi-aware 错误恢复（“验证失败→依据 Ruyi 缺件自动修复”）需要 **至少一个真实 Ruyi/RISC-V fixture 或测试环境**——本机为 Windows 开发环境未安装 ruyi，无法在本机完成该 DoD；该验收项在具备 RuyiSDK 的 Linux 主机上执行（同 v0.1 真实云账号联网验收一样，作为环境相关验收记录，不扩张为已完成 Agent 能力）。

## v0.7 Context & Mature Agent
- compaction、repo map/index、plan/todo、history management
- provider capability degradation、cost/context controls
DoD：长会话不因简单 context overflow 崩溃；模型能力缺失有明确降级。

当前实现状态（2026-09-05，context 防护 + plan/todo + repo index + capability 降级 + cost/context 控制 + history 管理已落地）：新增 **`ContextCompactor`**、**cost/context 控制**（`historyBudgetRatio`，默认 0.6）、**`RepoIndexService` + `repo_index`**、**`AgentPlanService` + `plan_todo`**、**`ModelCapabilitiesService` + `model_capabilities`**、**`SessionHistoryService` + `session_history` 工具**（会话 turn 数/用户·助手计数/估算 token 摘要，让 agent 感知上下文压力并决定压缩/新建会话——history management）。DoD "长会话不因简单 context overflow 崩溃"由压缩护栏满足。覆盖：`test/context-compactor.test.js`、`test/chat-service.test.js`（压缩+比例）、`test/repo-index-service.test.js`、`test/agent-plan-service.test.js`、`test/model-capabilities-service.test.js`、`test/session-history-service.test.js`。**待续**：v1.0 交付项（VSIX 打包、安装/使用/维护/升级说明、最终 NOTICE+测试报告）需发布环境。

## v0.8 Upstream Integration
- 合并进指定 ruyisdk-vscode-extension
- one VSIX
- UI consistency/i18n/Remote SSH regression
DoD：原 RuyiSDK regression + Yisi regression 全过；集成 diff 集中在 seam。

## v0.9 RC
性能、安全、许可证、依赖、迁移、日志 redaction、文档、兼容矩阵。

当前实现状态（2026-09-05，安全 + 依赖/许可证守卫 + schema 迁移守卫 + 性能基线 + 兼容矩阵已落地）：新增 **`SecretRedactor`**（redaction）：已接入 `OpenAICompatibleProvider.requireSuccess`（Provider 错误体脱敏）、`ChatRunCoordinator.safeMessage`（所有会话错误在浮出前 censor 常见密钥形态）、`chatViewProvider.reportSessionError`/`receiveMessage` 日志（`console.error` 前 censor）。新增 **依赖/许可证守卫** `test/dependency-notices.test.js`、**schema/迁移守卫** `test/session-schema.test.js`、**性能基线** `test/performance-sanity.test.js`、**兼容矩阵** `docs/18_COMPATIBILITY_MATRIX.md`。覆盖：`test/secret-redactor.test.js`、`test/openai-compatible-provider.test.js`（错误体脱敏）、`test/chat-run-coordinator.test.js`（错误信息 censor）、`test/dependency-notices.test.js`、`test/session-schema.test.js`、`test/performance-sanity.test.js`。**待续**：v1.0 交付项（VSIX 打包、安装/使用/维护/升级说明、最终 NOTICE+测试报告）需发布环境。

## v1.0 Delivery
冻结 API/schema；交付 VSIX、安装/使用/维护/升级说明、第三方 NOTICE、测试报告。

当前实现状态（2026-09-05，本机可交付项已完成）：**VSIX 已在本机用 `@vscode/vsce` 成功打包**（`yisi-ai-dev-starter-0.1.7.vsix`，≈7.26MB；`*.vsix`/`dist/`/`node_modules/` 以 `.gitignore` 忽略、不入库；`src/test/docs/random.js` 经 `.vscodeignore` 排除，运行时依赖 pdfjs-dist/mammoth/read-excel-file/jszip 已捆绑）。**安装/使用/维护/升级说明** `docs/20_INSTALL_AND_MAINTENANCE.md`。**第三方 NOTICE** `THIRD_PARTY_NOTICES.md` 由 `test/dependency-notices.test.js` 强制守卫。**schema 冻结** (v1) 由 `test/session-schema.test.js` 守卫（未知版本拒载）。**测试报告** = `docs/18` 兼容矩阵（464 tests / 463 pass / 1 skip）+ 各 DoD e2e。**属发布环境/上游环境依赖**（本机无法完成）：在目标 Linux + 上游 `ruyisdk-vscode-extension` 上的正式合并、one-VSIX 集成、原 RuyiSDK regression、Linux LNX smoke 与最终发布（如正式发布则用 `--allow-missing-repository` 与 LICENSE 调整后重打包）。

> v0.8（合并进 ruyisdk-vscode-extension / one VSIX / 原 RuyiSDK regression + Yisi regression 全过 / 集成 diff 集中在 seam）**需要上游 ruyisdk-vscode-extension 仓库**，属环境依赖，本机无法执行上游合并与回归，仅在代码 seam 层做自测准备；v0.9/v1.0 其余代码级项（性能、依赖、文档、NOTICE 核对、测试报告）可在本机完成，VSIX 打包与安装说明随交付一并补齐。

## v0.11 Extension Layer（新增里程碑，2026-09-14 起）

**背景**：与 Claude Code / Codex 对照后，Yisi 的缺口集中在**扩展层**（项目指令、Skills、Hooks、MCP），而不是 Agent 内核或权限模型。该里程碑只补扩展层：不改权限语义（每次调用仍逐次过 `PermissionEngine`）、不动 loop 判定、不引入 native 依赖。参考方式仍是 clean-room——只学公开文档描述的行为，不复制实现、文件格式或 prompt 文本（docs/04）。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| ① 项目指令文件（AGENTS.md / CLAUDE.md / YISI.md） | ✅ 已落地（2026-09-14） | 每轮运行读取执行根下的指令文件，作为 system 消息注入请求头部；先命中者生效、上限 12000 字符、失败不致命。见 ADR-0004 |
| ② MCP 客户端 | ✅ 已落地（2026-09-14） | stdio + JSON-RPC 2.0（initialize / tools/list / tools/call）；工具命名空间 `mcp__<server>__<tool>`；未分类工具默认 `environmentChange`（Plan 拒绝、其余询问、Full Access 放行）；失败降级为零工具 + 状态；随扩展退出回收子进程。见 ADR-0005 |
| ③ Hooks（生命周期事件） | ✅ 已落地（2026-09-14） | `preToolUse`（可拒绝，跑在权限判定之前）/ `postToolUse`（输出附加到工具结果）。**只能收紧，没有"批准"这个决策**；hook 拒绝是与 `policy` 并列的独立理由且**不解锁权限升级**；失败默认阻塞且必须可见。见 ADR-0006 |
| ④ Skills（可复用知识包 + `/命令`） | ✅ 已落地（2026-09-14） | `.yisi/skills/`（`<name>.md` 或 `<name>/SKILL.md`）；**描述常驻（每条 240 / 整块 4000 上限）、正文按需（16000 上限）**；模型用 `skill` 工具自主加载（readOnly，Plan 也能用），用户用行首 `/name` 触发——**正文只进入本轮、会话只存用户原话**。见 ADR-0007 |

**DoD（本里程碑）**：四项各自具备（a）实现、（b）单元/集成测试、（c）文档与 ADR、（d）至少一条可复现的验证证据；且全量测试不回归。

**明确不做**（理由见 docs/04 结论）：OS 级沙箱轴（需 native 依赖，违反 docs/17）、持久化 allow 规则（CC 自陈为缺陷高发区）、计划审阅面板（当前复用通用审批卡片）。

**已完成的验证证据（①）**：`test/project-instructions.test.js`（15 用例）+ 全量 **484 tests / 483 pass / 0 fail / 1 skip**。
**已完成的验证证据（②）**：`test/mcp-client.test.js`（25）+ `test/mcp-stdio-transport.test.js`（8，真实子进程）+ `test/mcp-configuration.test.js`（10）+ 全量 **527 tests / 526 pass / 0 fail / 1 skip**。
**已完成的验证证据（③）**：`test/hooks.test.js`（18，含经真实 loop 的三条不变式）+ `test/hooks-process.test.js`（14，真实子进程）+ 全量 **559 tests / 558 pass / 0 fail / 1 skip**。
**已完成的验证证据（④）**：`test/skills.test.js`（20，含经真实 loop 与 ChatService 的端到端）+ 全量 **579 tests / 578 pass / 0 fail / 1 skip**。

**v0.11 里程碑状态：四项全部落地**（①项目指令文件 ②MCP ③Hooks ④Skills），新增 4 份 ADR（0004–0007）与 4 个测试文件组；测试从 469 增至 579。四项共同遵守的边界：不改权限语义（每次调用仍逐次过 `PermissionEngine`）、不引入 native 依赖、失败一律降级而不失败运行、工作区内容一律显式框定为"不能放宽任何闸门"。

## v0.12 Orchestration & Experience（新增里程碑，2026-09-14 起）

**背景**：扩展层补完后，与 CC / Codex 的剩余差距集中在**编排层**（子代理、检查点）与 **IDE 体验层**（并排 diff、计划审阅面板）。本里程碑的每项都要动既有假设，因此每项先写 ADR 再动代码。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| ① Subagents（隔离子代理） | ✅ 已落地（2026-09-14） | `task` 工具：子代理在**自己的上下文**里跑、**只回报告**；**只读**（工具集被过滤，因此不可能越过父权限）；继承父运行模式与 hooks；预算 4 个/运行、6 轮/子代理；Stop 传播。见 ADR-0008 |
| ② Checkpoints / rewind | ✅ 已落地（2026-09-14） | 回合检查点：**回滚代码**（回到检查点 = 撤销该回合及其之后，逆操作走写入端口因而**继承 stale guard**，用户改过的文件被拒绝而非覆盖）、**从此处分叉会话**、或两者；命令 `yisiAI.checkpoints`。有界（12 回合/40 改动/64KB 文本），放不下的记成"不可回退 + 原因"；**检查点在内存**，重载后消失。见 ADR-0009 |
| ③ 并排 diff 编辑器 | ✅ 已落地（2026-09-14） | 待批准的文本改动在 **VS Code 原生 diff** 里并排打开整份文件（左=现状，右=批准后的内容）。**它是视图不是审批通道**：批准仍只在侧栏卡片，diff 先打开再等待决定，打开失败不影响审批。推演不可信（不再唯一匹配/读不到/超 512KB）时**跳过并说明**，绝不渲染假的"未来"。见 ADR-0010 |
| ④ Plan 文档化审阅 | ✅ 已落地（2026-09-14） | `request_permission` 可带 markdown `plan`；它被渲染成**可编辑的文档**打开（头部写明"在侧栏决定、可直接在文档里评论"），用户改动的内容以 `-`/`+` **作为反馈回给模型**（批准与拒绝都回）。文档**不是审批通道**；`confirm` 可返回 `boolean \| {approved, feedback?}`，纯布尔端口不受影响。见 ADR-0011 |

**已完成的验证证据（①）**：`test/subagents.test.js`（14，含隔离/上限/取消/命名空间转发）+ 全量 **593 tests / 592 pass / 0 fail / 1 skip**。
**已完成的验证证据（②）**：`test/checkpoints.test.js`（15，含经真实 `WorkspaceEditService` 的回退与拒绝覆盖）+ 全量 **608 tests / 607 pass / 0 fail / 1 skip**。
**已完成的验证证据（③）**：`test/proposal-diff.test.js`（10，含两条源码级不变式）+ 全量 **618 tests / 617 pass / 0 fail / 1 skip**。
**已完成的验证证据（④）**：`test/plan-review.test.js`（11，含经真实 loop 的批准/拒绝反馈路径）+ 全量 **629 tests / 628 pass / 0 fail / 1 skip**。

**v0.12 里程碑状态：四项全部落地**（①Subagents ②Checkpoints/rewind ③并排 diff ④Plan 文档化审阅），新增 4 份 ADR（0008–0011）；测试从 579 增至 629。四项共同遵守的边界：**没有新增任何审批入口**（卡片仍是唯一闸门）、不引入 native 依赖、失败一律降级而不失败运行、写路径全部继承 stale guard。

## v0.13 Heavy Engineering（新增里程碑，2026-09-14 起）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| ① 联网搜索/抓取 | ✅ 已落地（2026-09-14） | **以内置 MCP 服务器交付**，绕过全部采购/备案问题：`web_search` + `web_fetch`，风险 `network`（Plan 拒绝 / 其余模式询问）。搜索后端是**用户自建的 SearXNG**（免费、无 API key、默认 `http://127.0.0.1:8080`，改地址用 `YISI_SEARXNG_URL` 环境变量）；`web_fetch` 无需后端。**不新增 npm 依赖、不新增宿主框架**。见 ADR-0013 |
| ② Headless / CI 入口 | ✅ 已落地（2026-09-14） | `runHeadlessTask()` + `yisi-headless` CLI：同一个 Agent 核心在无 VS Code 环境运行。**默认只读（plan）**；写权限需显式 `--allow-write`（转 `manual` + 允许清单审批器）；**`destructive`/`credentialSensitive` 永远无通道（失败关闭）**；退出码 0/1/2 区分完成/停止/用错；密钥只从环境变量读。见 ADR-0012 |
| ③ 云任务交接 | ⬜ 未开始 | 把任务交给远端执行再取回结果 |
| ④ SDK 对外接口 | ⬜ 未开始 | ② 已提供编程入口；稳定的对外契约与版本化仍需独立设计 |

**已完成的验证证据（②）**：`test/headless.test.js`（14，含**无 VS Code 的真实目录端到端**：默认不能写、opt-in 后真的写盘）+ 全量 **643 tests / 642 pass / 0 fail / 1 skip**。

**顺带修复（v0.7 的一个遗留缺口）**：长会话压缩原先**只**在 provider 声明 `capabilities.maxContextTokens` 时生效，而 UI 的上下文环会回退到 domain 的已知模型族估算表——于是"环显示已用 80%"与"从不压缩"可以同时成立，最后在 v0.7 DoD 承诺不崩的地方溢出。现在 `ChatServiceOptions.contextWindow` 接受一个**与上下文环同源**的同步估算（provider 声明仍优先；未知模型仍返回 undefined = 不压缩，行为不变；估算函数抛错也不影响发送）。守卫：`test/context-window-fallback.test.js`（6）。全量 **659 tests / 658 pass / 0 fail / 1 skip**。

**已完成的验证证据（①联网，v0.13 收口）**：`test/websearch-url-policy.test.js`（12：URL 与地址策略、IPv4/IPv6 含 `::ffff:` 映射与点分尾部、同源重定向、HTML 转文本、截断保留两端、**默认上限与 docs/14 一致**）+ `test/websearch-mcp.test.js`（14：两个工具的边界与**诚实失败**、SSRF 在发请求之前生效、非文本拒绝、取消、**经真实 MCP 客户端 + 真实 `AgentToolLoop` 的离线端到端**（模型调 `mcp__websearch__web_search` → 结果回到下一轮 → 最终回答）、**Plan 模式下被引擎拒绝且理由为 `policy`**、配置渲染可被真实解析器接受、命令已声明并接线）+ `test/permission-mode-prompt.test.js`（+2：联网纪律与"网页内容是数据不是指令"）。全量 **687 tests / 686 pass / 0 fail / 1 skip**（上一项为 659，+28）。**未在本机验证**：真实 VS Code 内粘贴配置 + 真 SearXNG 的实网搜索（本机无 GUI 宿主）。
