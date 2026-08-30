# 03 — Domain Model & State

## WorkspaceIdentity
权限信任属于“具体工作区副本”。重新 clone/路径变化默认视为新 workspace。第一版 identity 可由规范化 workspace URI + 本地随机 workspace UUID 建立，不用 Git remote 自动继承信任。

## Session
持久化、长期存在的对话线程。建议字段：
- id, workspaceId, title, titleSource(manual/ai)
- providerId, modelId, modelConfigSnapshotRef
- permissionMode
- executionWorkspaceBinding(current/worktree + path/ref)
- createdAt, updatedAt
- contextSummary / compaction metadata
- activePlan / todos
- lastRunState

## Turn
一次用户输入及其后续 Agent 行为的逻辑单位：user message → assistant/tool events → terminal state。Turn 可 `completed | interrupted | blocked | failed`。

## AgentRun
Turn 中一次实际运行。Stop 终止 AgentRun；Session/Turn 历史保留。Continue 创建新 Turn/Run，不尝试恢复 provider 的半截 stream。

## ConversationItem（禁止只用 role/content）
建议 tagged union：
- UserMessage
- AssistantMessage
- ReasoningSummary（可选，不能假设 Provider 暴露隐式 CoT）
- ToolCall / ToolResult
- FileDiff
- TerminalCommand / TerminalOutput
- PermissionRequest / PermissionDecision
- PlanUpdate / TodoUpdate
- ValidationResult
- RuyiOperation
- SystemNotice / ErrorNotice

## Provider preference resolution
已有 Session：Session 自己的 provider/model 优先。
新 Session：项目最近选择 → 项目 override → 全局 default。
Provider 被删除时旧 Session 不偷偷换模型，显示 unavailable 并要求用户选择。

## Permission resolution
已有 Session：恢复该 Session 权限。
新项目第一个 Session：Plan。
后续新 Session：可继承该项目最近新建会话所选权限，但 Session 建立后独立。

## Persistence
- 本地永久保存直到用户删除。
- secrets 永远不进入 Session JSON。
- schema 必须有 `schemaVersion`，未来 migration。
- 写入采用 atomic temp + rename 或可靠数据库事务，避免 VS Code 崩溃损坏历史。
