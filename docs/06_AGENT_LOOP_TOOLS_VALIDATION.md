# 06 — Agent Loop, Tools & Validation

## Agent Loop
```text
User Turn
→ build context
→ LLM request
→ assistant/tool proposal
→ validate tool schema
→ PermissionEngine
→ execute in ExecutionWorkspace
→ normalize ToolResult
→ persist event
→ feed result to LLM
→ ...
→ completion candidate
→ ValidationPlanner
→ validation evidence
→ final response OR continue repair
```

## Loop Guard
不是固定“重试 5 次”。内部至少检测：
- 用户 Stop / cancellation token
- 连续相同 tool + 相同 args
- 连续相同错误且无 workspace/context 变化
- 无进展计数
- tool call / wall-clock / token soft budget
- context pressure → compaction
- permission blocked / missing user input
达到 guard 时给出阻塞原因和已完成工作，不伪装成功。

## Agent 请求的 system prompt 组成

每次 Agent 运行的消息数组由 `AgentToolLoop.run()` 组装，**两段 system 内容，位置不同**：

| 位置 | 内容 | 是否随模式变化 | 构建者 |
|---|---|---|---|
| **头部**（`messages[0]`） | **角色 + 工具使用纪律**：通识问题直接用自身知识回答、只在需要**本工作区事实**时才调工具、用最小工具集、不投机性探索、用用户的语言回答 | 否（稳定，可进缓存前缀） | `application/agent/agentSystemPrompt.ts` |
| **历史之后、当前用户轮之前** | **权限模式简报**：当前模式允许什么、被拒之后怎么办、`request_permission` 的约束 | 是 | `application/agent/permissionModePrompt.ts` |

**为什么必须两段都在**：agent 路径原先**没有任何 system prompt**（只有对话 + ~24 个工具定义 + `tool_choice: 'auto'`）。结果是问"请你介绍一下RISC-V吧"这种通识问题时，模型匹配到工具描述里的 "RISC-V" 字样，去调了 `ruyi_check` 和 `list_directory`——它不是在"思考要查环境"，而是**没有任何东西告诉它通识问题不需要工具**。修权限那次只补了模式简报，角色/纪律这段是后来补的。

**不要**把模式限制写进角色提示（那会让头部随模式变化、破坏缓存前缀，也是两种关注点的混淆）；**不要**把角色/纪律写进模式简报（会被当成随模式变化的东西重复发送）。守卫：`test/permission-mode-prompt.test.js` 断言头部恒为角色提示、简报紧随用户轮之前、二者内容互不越界。

## 过程可见性：思考轨迹与可展开的步骤

用户要求"看到过程、点击看详情"（对齐 DSH 的轨迹视图）。两条规则：

**① 思考（thinking）是 UI 轨迹，不是对话内容。** 思考模式模型的 `reasoning_content` 在传输层被捕获为**独立事件**（`AgentStreamEvent.reasoningDelta`），loop **实时**用 `onDelta(text, 'reasoning')` 转发（不缓冲到本轮结束——思考只有在"正在发生"时才有价值），coordinator 发 `assistantReasoningDelta`，webview 渲染为可折叠块。硬约束：

- **绝不进入 `messages`**——它不是对话内容，不会回灌给模型；
- **绝不持久化**——不属于 session items，状态刷新即重建视图、轨迹自然消失（与"中断的部分文本只是临时 UI 状态"同一原则）；
- **不改变循环判定**：provider 里 `reasoning_content` **不置 `emitted`**，所以"只思考、没有 content 也没有 tool call"的一轮仍然按空响应处理（有测试锁定）；
- 出现位置在**它产出的回答之上**（`insertBefore(transientAssistant)`），流式时展开、run 结束时自动折叠并显示字数。

**② 工具步骤可折叠（渐进式披露，docs/19）。** 每个步骤是 `<details>`：`summary` 是单行标签（`🔧 名称 · ✓/✕`），展开体是入参与结果。工具结果事件同时带两个有界字段：`summary`（600 字符，供折叠行）与 `detail`（8000 字符，供展开体）——"展开才看细节"因此是真正的可选操作，而不是把大结果默认铺满。

守卫：`test/agent-trace.test.js`（loop 转发 kind 与顺序、思考不入 messages、`detail` 长于 `summary`、拒绝步骤也带 detail、coordinator 不把思考混进回答文本、webview 用 `<details>` 且不把推理回传宿主）。

## Core Tools（建议阶段）
ReadFile, ListDirectory, SearchText, SearchFiles, GetSymbols, ReadDiagnostics, ApplyPatch/EditFile/CreateFile/DeleteFile, RunCommand, StartProcess/StopProcess, GitStatus/GitDiff, Ruyi* tools。

## Edit safety
- edit 前记录文件版本/hash；写入前检查 stale write。
- 尽量 patch/range edit，不盲目重写大文件。
- 保存 DiffEvent，支持 Undo 所需反向 patch/快照元数据。
- Manual：proposal/diff → approval → write。
- Accept Edits/Auto：write → visible diff; risk ops 仍过 PermissionEngine。

当前最小写入切片只支持已有 UTF-8 文件中的唯一文本替换，并要求 `read_file` 返回的 SHA-256 作为 stale guard。成功写入会把有界的即时 VS Code diagnostics 快照放入结构化工具结果；该快照仅供下一轮判断，不等于语言服务已经刷新完毕，也不替代完成前的有效验证。

## Validation
修改批次后可做轻量 diagnostics；准备完成时至少一次“有意义验证”。ValidationPlanner 根据项目选择相关 tests/build/typecheck/lint，不要求所有项目跑全部命令。

成功声明必须携带 evidence，例如：
- `npm test -- foo` exit 0
- `cmake --build build` exit 0
- related diagnostics: 0 errors
如果没有验证手段：明确“修改完成但未自动验证”。

## 长进程
StartProcess 返回 process handle；UI 显示 Running/Stop/Open Terminal。Extension deactivation 尽力停止受管子进程。重启 VS Code 后记录为 stopped，可 Resume（重新执行启动定义），绝不声称恢复原 PID。
