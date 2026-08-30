# 11 — Testing, Evaluation & CI

## Unit
PermissionEngine、provider normalization、tool schema、session migration、loop guard、path/ignore rules、Ruyi porcelain parser。

## Integration
- fake LLM provider 驱动完整 agent loop
- temp git repo：edit/diff/undo/worktree/dirty delete guard
- fake process：stdout/stderr/cancel/timeout/long process
- fake Ruyi executable：不同 porcelain schema/exit code
- SecretStore mock：确保 session/log 不含 secret

## VS Code E2E
Extension activation、Webview handshake、selection context、Diagnostics、Remote SSH 手工矩阵/可自动部分。

## Agent benchmark（内部）
固定小型 fixture repos，任务包括：定位 bug、跨文件修改、测试失败修复、untracked 文件、gitignored 显式引用、并发 worktree、Ruyi 环境模拟。记录 success rate、tool calls、wall time、tokens、invalid tool calls、permission prompts、verification pass。

## Provider compatibility matrix
至少测试：OpenAI-compatible、DeepSeek/其他云、Anthropic（若实现）、llama.cpp compatible server。对每个记录 streaming/tool calling/structured output/context 限制和降级路径。

## CI gates
Typecheck + lint + unit + integration + package build + dependency/license scan。任何涉及 permission/process/file write 的变更必须有测试。
