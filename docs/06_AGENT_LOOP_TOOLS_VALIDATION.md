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

每次 Agent 运行的消息数组由 `AgentToolLoop.run()` 组装，**三段 system 内容，位置不同**：

| 位置 | 内容 | 是否随模式/工作区变化 | 构建者 |
|---|---|---|---|
| **头部**（`messages[0]`） | **角色 + 工具使用纪律**：通识问题直接用自身知识回答、只在需要**本工作区事实**时才调工具、用最小工具集、不投机性探索、用用户的语言回答 | 否（稳定，可进缓存前缀） | `application/agent/agentSystemPrompt.ts` |
| **紧随其后**（`messages[1]`，仅有指令文件时） | **项目指令**：工作区 `AGENTS.md` / `CLAUDE.md` / `YISI.md` 的约定，先命中者生效，上限 12000 字符 | 随工作区变化，但一个工作区内稳定（仍在缓存前缀内） | `application/agent/projectInstructions.ts` + `application/context/projectInstructionsService.ts`（ADR-0004） |
| **历史之后、当前用户轮之前** | **权限模式简报**：当前模式允许什么、被拒之后怎么办、`request_permission` 的约束 | 是 | `application/agent/permissionModePrompt.ts` |

实际顺序：`[角色, 项目指令?, ...保留历史, 模式简报, 当前用户轮]`。

**为什么必须三段都在**：agent 路径原先**没有任何 system prompt**（只有对话 + ~24 个工具定义 + `tool_choice: 'auto'`）。结果是问"请你介绍一下RISC-V吧"这种通识问题时，模型匹配到工具描述里的 "RISC-V" 字样，去调了 `ruyi_check` 和 `list_directory`——它不是在"思考要查环境"，而是**没有任何东西告诉它通识问题不需要工具**。修权限那次只补了模式简报，角色/纪律这段是后来补的；项目约定则是第三块缺失的信息（CC 用 CLAUDE.md、Codex 用 AGENTS.md 补的就是这块）。

**项目指令是工作区内容，不是操作者指令**：它被显式框定为不能改变工具集、权限规则或模式简报，与用户请求冲突时以用户为准。该框定只是声明，**强制力仍然只来自 PermissionEngine**（逐次判定，见 docs/07）——恶意仓库无法靠自己的 AGENTS.md 拿到任何越权。

**不要**把模式限制写进角色提示（那会让头部随模式变化、破坏缓存前缀，也是两种关注点的混淆）；**不要**把角色/纪律写进模式简报（会被当成随模式变化的东西重复发送）。守卫：`test/permission-mode-prompt.test.js` 断言头部恒为角色提示、简报紧随用户轮之前、二者内容互不越界；`test/project-instructions.test.js` 断言项目指令落在角色提示之后、历史之前，且无指令文件时不新增任何 system 消息。

## 过程可见性：思考轨迹与可展开的步骤

用户要求"看到过程、点击看详情"（对齐 DSH 的轨迹视图）。两条规则：

**① 思考（thinking）是 UI 轨迹，不是对话内容。** 思考模式模型的 `reasoning_content` 在传输层被捕获为**独立事件**（`AgentStreamEvent.reasoningDelta`），loop **实时**用 `onDelta(text, 'reasoning')` 转发（不缓冲到本轮结束——思考只有在"正在发生"时才有价值），coordinator 发 `assistantReasoningDelta`，webview 渲染为可折叠块。硬约束：

- **绝不进入 `messages`**——它不是对话内容，不会回灌给模型；
- **绝不持久化**——不属于 session items，状态刷新即重建视图、轨迹自然消失（与"中断的部分文本只是临时 UI 状态"同一原则）；
- **不改变循环判定**：provider 里 `reasoning_content` **不置 `emitted`**，所以"只思考、没有 content 也没有 tool call"的一轮仍然按空响应处理（有测试锁定）；
- 出现位置在**它产出的回答之上**（`insertBefore(transientAssistant)`）；**默认折叠且保持折叠**，标签是**单行动态预览** `思考 · <已用思考时间> · <思考首行>`（随 delta 实时更新、CSS `nowrap + ellipsis` 保证只有一行），点开才看全文。**不要**做成"流式自动展开"——用户明确要求它像一行状态那样克制，不挤占回答位置。
- **已用思考时间按「思考段」累计**（用户后续要求"在过程中显示当前思考多少时间"）：首个 `reasoningDelta` 开段并启动 250ms `setInterval`（ticker 的意义是"没有 delta 也要看得出还活着"，不是计时精度），第一个 `assistantStreamDelta` 或 `agentToolCall` 闭段；闭段时把该段时长累加并立即重写标签，于是**数字在思考停止的瞬间冻结**，行上留下"这次想了多久"。**只累加思考段**：agent run 是 思考→工具→再思考，若按整轮墙钟计时会把工具执行与回答生成都算成思考，严重高估。时间字段放在首行预览**之前**，长预览被 ellipsis 截断时不会把时间挤掉。
  实现落在 webview 客户端脚本（纯 UI 状态，与"不持久化"一致）：`reasoningElapsed` / `reasoningStartedAt` / `reasoningTimer` + `currentReasoningMs()` / `formatDuration()` / `reasoningLabel()` / `openReasoningSegment()` / `closeReasoningSegment()`，并由 `finalizeReasoning()` 统一收口。`formatDuration` 在 60s 以下给 `3.4s`，以上给 `1m 05s`；`NaN`/负数退化为 `0.0s`，绝不在行上渲染 `NaN`。
  **`renderActiveSession()` 必须调用 `finalizeReasoning()`**：它执行 `conversation.replaceChildren()` 抹掉那条临时轨迹，若不同时清掉 `reasoningTimer`，ticker 会对着已分离的节点继续空转，后续 delta 也会写进看不见的 DOM。每个 run 边界（`assistantStreamStarted`/`assistantStreamCompleted`/`sessionError`/`runStopped`）同样走这一个收口函数。

**② 工具步骤可折叠（渐进式披露，docs/19）。** 每个步骤是 `<details>`：`summary` 是单行标签（`🔧 名称 · ✓/✕`），展开体是入参与结果。工具结果事件同时带两个有界字段：`summary`（600 字符，供折叠行）与 `detail`（8000 字符，供展开体）——"展开才看细节"因此是真正的可选操作，而不是把大结果默认铺满。

守卫：`test/agent-trace.test.js`（loop 转发 kind 与顺序、思考不入 messages、`detail` 长于 `summary`、拒绝步骤也带 detail、coordinator 不把思考混进回答文本、webview 用 `<details>` 且不把推理回传宿主）；思考计时由 `test/chat-view-source.test.js` 用**假时钟驱动真实函数**验证（两段思考跨一次 30s 工具调用后必须累加为 7.0s 而不是 37s，闭段后数字不再移动，`finalizeReasoning()` 后回到零且 ticker 全部被清理）。

## Core Tools（建议阶段）
ReadFile, ListDirectory, SearchText, SearchFiles, GetSymbols, ReadDiagnostics, ApplyPatch/EditFile/CreateFile/DeleteFile, RunCommand, StartProcess/StopProcess, GitStatus/GitDiff, Ruyi* tools。

**MCP 桥接工具（`mcp__<server>__<tool>`，ADR-0005）**：由 `yisiAI.mcpServers` 配置的本地服务器贡献，运行时并入同一个 `ToolRegistry`（因此同样逐次过 `PermissionEngine`）。它们**不受执行根约束**（服务器是全局的，不随 worktree 变化），命名空间 `mcp__` 为保留前缀以防遮蔽内置工具。未分类工具的风险类固定为 `environmentChange` + `mutatesWorkspace: true`，是 loop bounded scope 接纳的四种组合之一；桥接层强制规范化这张表。

## Hooks 在 loop 中的位置（ADR-0006）

```
工具解析 → bounded scope 检查 → [preToolUse hooks] → PermissionEngine → 审批卡片 → 执行 → [postToolUse hooks] → 工具结果入 messages
```

- **`preToolUse` 跑在权限判定之前**：它的用途就是"在执行前挡住"（文档化的护栏用法）。它可以 `deny`，也可以只加 `context`。
- **它不能批准任何东西**：决策词汇只有 `allow`/`deny`，`allow` 之后引擎与审批卡片照常运行。
- **hook 拒绝是独立理由 `hook`**，与 `policy`/`user`/`unavailable` 并列，且**不计入 `policyDenials`**——放宽模式解不开 hook，所以它不得解锁 `request_permission` 升级。模型收到的指引明确写了这一点。
- **`postToolUse` 成功/失败都会跑**，其 `context` 通过 `withHookContext()` 作为 `hookContext` 字段并入工具结果 JSON（保持可解析），因此"改完跑 linter"的结果会进入下一轮模型可见的证据。
- **Stop 优先**：hook 返回后立即 `signal.throwIfAborted()`，取消不会被伪装成护栏拒绝。
- 守卫：`test/hooks.test.js`（含三条不变式的端到端用例）+ `test/hooks-process.test.js`。

## Skills（ADR-0007）

请求头部的第三块稳定内容（角色 → 项目指令 → **skill 目录**）。**上下文预算就是这条特性的设计核心**：

- **目录常驻**：只有名称 + 一行描述，每条 ≤240 字符、整块 ≤4000 字符，超限截断带标记；**没有 `.yisi/skills/` 的工作区零成本**。
- **正文按需**：单次 ≤16000；只有 `skill` 工具被调用、或用户用行首 `/name` 触发时才读。
- 两条进入路径都不把正文写进会话：工具结果是数据；`/name` 把正文作为**当前轮的一条消息**插在用户轮之前（与权限简报同位），**会话里存的仍是用户原话**——否则一份 16k 的 skill 会在之后每一轮重发。
- `skill` 工具是 `readOnly` + 非写（就是读一个工作区文件），因此 **Plan 模式下也可用**，且不新增任何权限面。skill 正文与目录都是工作区内容，注入时带"不能改变工具集/权限规则/模式简报"的框定。

## Subagents（ADR-0008）

`task` 工具让模型派一个**隔离子代理**：它在自己的 loop 里工作，**父上下文只收到 `report`**。

- **只读**：子代理的 registry 是**过滤出来的**（`readOnly && !mutatesWorkspace && !permissionEscalation && !spawnsSubagent`）。因此"子代理不可能越过父权限"是**结构性**的——没有特权工具可调、没有升级工具可问、没有东西需要批准。
- **子代理是普通工具 + 特殊执行体**，不是独立路径：它同样走 bounded scope → preToolUse hooks → `PermissionEngine` → 审批 → postToolUse hooks，只有执行那一步换成嵌套 loop。这样它自动继承取消、结果有界、步骤事件与后置 hook，也避免出现第二套权限逻辑。
- **请求头部多一块**（紧随角色提示）：子代理简报，写明"你不是在跟用户说话、你只能观察、只有报告会回去"。
- **隔离**：子代理只拿到 `prompt`（没有父对话历史），但共享工作区上下文（项目指令、skill 目录）与 hooks，并**继承父运行的权限模式**。
- **回报边界**：只有 `report`（≤8000）回流；子代理的工具步骤事件带命名空间转发给 UI（`subagent:<描述>:<id>`），避免与父 transcript 的 callId 冲突。
- **有界**：≤4 个子代理/运行、≤6 轮/子代理、**串行**执行；超预算终止运行。Stop 通过共用 `AbortSignal` 传播。

## Checkpoints（ADR-0009）

检查点不是 loop 的一部分，而是**围绕会话回合**的记录：`ChatService` 在每次请求开始时开一个回合边界，`WorkspaceEditService` 把每个成功改动记进当前回合（与 journal 同一处产生）。

- **回退** = 撤销该回合及其之后的全部改动，按回合从新到旧、回合内从后到前执行逆操作；每个逆操作走**写入端口**，因此继承 stale guard（用户改过的文件被拒绝，绝不覆盖）。
- **分叉** = 在检查点之前切开对话（保留更早的历史），代码原样保留。
- 入口是命令 `yisiAI.checkpoints` + QuickPick；**不是 agent 工具**（用户撤销 agent，不受 agent 专属限制），因此不在工具清单里。

## 待批准改动的并排 diff（ADR-0010）

需要确认的文本编辑会在 **VS Code 原生 diff** 里并排打开整份文件（左=现状，右=批准后的内容），因此审批可以在**上下文里**判断，而不是只看 `-old / +new` 片段。

- **它是视图，不是审批通道**：批准仍只发生在侧栏卡片；`ProposalDiffPresenter` 拿不到 `ApprovalBroker`（源码级断言），diff 在 `await` 决定**之前**以 fire-and-forget 打开。
- 右侧由 `yisi-proposal` **虚拟文档**从内存提供：**批准前不落盘**。左侧在当前内容一致时用**真实文件**（保留语言与 git 装饰）。
- **推演不可信就跳过**：`replace_text` 要求 `oldText` 在当前内容中恰好出现一次（与工具自身的唯一匹配一致）；不匹配/不唯一/读不到/超 512KB → 跳过并说明，绝不显示不会真正发生的结果。

## Plan 文档化审阅（ADR-0011）

Plan 模式的被审阅退出（`request_permission`）可携带 markdown `plan`，它经 `buildPlanDocument` 渲染成**可编辑文档**打开；用户决定后，`extractPlanFeedback` 把**被改动的行**作为反馈回给模型（批准附在工具结果里，拒绝附在拒绝理由里）。

- **文档不是审批通道**：决定仍只在侧栏卡片；且批准仍须满足既有四处约束（有据可依、严格更宽、每运行一次、人来批）。
- **反馈只回 diff**（≤2000 字符），不整份回传；反馈是**指导**，不放宽也不收紧引擎判定。
- `ToolConfirmationPort.confirm` 返回 `boolean | {approved, feedback?}`，loop 归一化两种形态——纯布尔端口一行未改。

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
