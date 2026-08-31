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
