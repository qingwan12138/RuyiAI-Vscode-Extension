# 05 — Modules & Technology Choices

## 基础技术
- Extension Host：TypeScript，VS Code Extension API。
- UI：TypeScript + React（推荐）+ Vite/esbuild；UI 与 host 使用 typed protocol。若为减少依赖也可先 vanilla，但最终复杂聊天 UI 推荐 React。
- Validation/schema：推荐 Zod（同时校验 Webview 消息、Provider tool args、持久化 migration 输入）。
- 测试：Vitest/Jest 二选一；VS Code integration 使用 `@vscode/test-electron` 或当前官方推荐 harness。
- 打包：esbuild/tsup 选一个；必须确认 native deps/Remote SSH 兼容。

## 不建议一开始引入
- LangChain/LlamaIndex 作为 Agent Core：抽象过重、行为难控；Provider SDK 可薄封装。
- Electron/独立后台服务：VS Code Extension Host 已是宿主，除非后期确有隔离需求。
- SQLite native binding：Remote SSH/跨平台打包复杂。第一版优先 JSONL/JSON + atomic writes；规模证明需要后再评估 SQLite/WASM。
- Ollama 强依赖：第一版本地模型只通过 OpenAI-compatible endpoint 连接 llama.cpp 等服务。

## 模块建议

### llm/
`LLMGateway`, `ProviderRegistry`, adapters。能力描述 `ModelCapabilities`：streaming, nativeToolCalling, structuredOutput, vision, reasoningControls, maxContextTokens 等。Agent 依据 capabilities 降级，不能假设所有模型支持同一工具协议。

### conversation/session/
Repository + migration + title service + compaction。会话标题生成失败时 fallback 第一条用户消息截断。

### context/
Selection/File/FolderScope/Symbol/Diagnostics/Terminal/GitDiff/RuyiEnv。Folder 只建立 scope；检索按需读取。以后可做 RepoMapProvider。

### tools/
统一 registry；每个 tool 必须声明：id, description, input schema, risk class, mutatesWorkspace, supportsCancellation, execution target。

### process/
AgentProcessRunner 用 child_process/spawn 捕获 stdout/stderr/exit/cancel；InteractiveTerminalBridge 用 VS Code Terminal 处理真正交互命令。两者不要混为一个接口。

### git/worktree/
GitAdapter + WorktreeManager。并发写 session 需要 isolation；检测 dirty worktree；删除前检查未提交修改。

### validation/
ValidationPlanner 根据项目探测结果选择 diagnostics/build/test/lint/typecheck/Ruyi validation；不是固定脚本列表。

### ruyi/
`RuyiPort` + `RuyiCliAdapter`。优先 `--porcelain` 机器接口并做 schema version parsing。上游 UI refresh 是 optional host bridge。

### security/
SecretStore, PermissionEngine, Redactor。日志和 telemetry（若未来有）必须先 redaction。
