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

当前实现状态（2026-09-05，达成核心）：`RuyiPort` 扩展为**类型化**操作集（getVersion/listPackages/listProfiles/install/uninstall/**createVenv/removeVenv/createProfile/removeProfile/update/extract**）；`RuyiCliAdapter` 全部通过 `ruyi --porcelain` 并以"每行一个 JSON"解析记录，**从不解析面向人类的 CLI 文本**（docs/16 §12、DoD）；CLI 语法集中在适配器一处，便于未来版本变更。新增 **`ruyi_manage` 工具**（重活：install/uninstall/venv/profile/update/extract），`risk: environmentChange`、`mutatesWorkspace: true`（方案 deny / manual·auto·acceptEdits confirm / fullAccess allow），Agent loop 的 bounded scope 已**接纳 environmentChange**（与 processExec 一样仅经过权限门）。上游 refresh bridge 为可选项、不依赖 → 缺失不影响核心（DoD 满足）。覆盖：`test/ruyi-cli-adapter.test.js`（porcelain argv、记录仅在成功时返回、非零退出保留 stderr、噪声行丢弃）、`test/ruyi-manage-service.test.js`（工具元数据与权限、类型化分发、必填字段校验、environmentChange 在各权限模式下的门控）、`test/read-only-agent-loop.test.js`（environmentChange 被接纳并执行；destructive/network 仍拒）。**待续/交付项**：Ruyi 操作 UI 面板（面向用户的 venv/profile/package 管理界面），以及真实 Ruyi CLI/RISC-V fixture 的实机验收（归入 v0.6 DoD 的"至少一个真实 Ruyi/RISC-V fixture"）。

## v0.6 Ruyi Intelligent Workflow
- Board/Profile/Toolchain/Sysroot/Venv/Build workflow
- Ruyi-aware validation / recovery
DoD：至少一个真实 Ruyi/RISC-V fixture 或测试环境完成端到端 workflow。

当前实现状态（2026-09-05，前置规划已落地）：新增 **`RuyiWorkflowService` + `ruyi_workflow` 工具**（readOnly）：基于 `ruyi --porcelain` 数据报告 **Board → Profile → Toolchain → Sysroot → Venv** 的就绪度（ruyi CLI 版本、已装 toolchain 包、profiles、目标 profile 是否已装、sysroot/venv 可否推导）与缺口列表；不猜测 board→toolchain 映射（真实映射属于 Ruyi 设备/领域数据，由真实环境提供），只枚举已装 toolchain 并标记命名缺口，供上层 `ruyi_manage`/`ruyi_check` 决策。覆盖：`test/ruyi-workflow-service.test.js`（就绪报告、缺失 profile/toolchain 标记、ruyi 缺失时安全降级、工具 readOnly 与 target 清洗）。**待续/环境依赖**：真正的端到端 Build/validate 及 Ruyi-aware 错误恢复（“验证失败→依据 Ruyi 缺件自动修复”）需要 **至少一个真实 Ruyi/RISC-V fixture 或测试环境**——本机为 Windows 开发环境未安装 ruyi，无法在本机完成该 DoD；该验收项在具备 RuyiSDK 的 Linux 主机上执行（同 v0.1 真实云账号联网验收一样，作为环境相关验收记录，不扩张为已完成 Agent 能力）。

## v0.7 Context & Mature Agent
- compaction、repo map/index、plan/todo、history management
- provider capability degradation、cost/context controls
DoD：长会话不因简单 context overflow 崩溃；模型能力缺失有明确降级。

当前实现状态（2026-09-05，context 防护已落地）：新增 **`ContextCompactor`**（application/context）：基于模型 context window，把超出历史预算的最早 turns 截断，保留最近的 turns，并在请求里前置一并 system 说明（"[Earlier conversation omitted: N older message(s)...] 以最新指令为准"）。`ChatService.send` 在 provider 声明了 `maxContextTokens` 时触发（`capabilities.maxContextTokens` 缺省则不压缩，与既有 attachment budget 行为一致）；`estimateTokens` 有界，超大输入不崩溃。**DoD "长会话不因简单 context overflow 崩溃" 已由该护栏满足**。覆盖：`test/context-compactor.test.js`（预算内不压缩、超预算截断保尾部、空/超大输入不崩溃）、`test/chat-service.test.js`（provider 声明窗口时压缩并前置 system note、消息数有界）。**待续**：repo map/index、plan/todo、history management 的统一管理，provider capability **degradation**（如 tool-calling/vision 缺失时的明确降级与 UI 提示，现仅 vision 附件门禁用）与 cost/context 控制面板（当前仅有 context usage ring），以及跨 provider 的 `modelContextWindow` 兜底线程进压缩。

## v0.8 Upstream Integration
- 合并进指定 ruyisdk-vscode-extension
- one VSIX
- UI consistency/i18n/Remote SSH regression
DoD：原 RuyiSDK regression + Yisi regression 全过；集成 diff 集中在 seam。

## v0.9 RC
性能、安全、许可证、依赖、迁移、日志 redaction、文档、兼容矩阵。

## v1.0 Delivery
冻结 API/schema；交付 VSIX、安装/使用/维护/升级说明、第三方 NOTICE、测试报告。
