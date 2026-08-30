# ADR-0001 — Linux Local-First

## Status
Accepted

## Decision
Yisi AI v1.0 当前正式交付范围仅包含 Linux 本机 VS Code 工作区。

Remote-SSH 延后到后续版本，不纳入当前版本 DoD、CI 必选矩阵和交付验收。

## Reasons
1. 当前项目真实应用场景是 Linux。
2. 先把 Coding Agent + RuyiSDK 核心能力做成熟，避免过早承担 Remote 生命周期复杂度。
3. Remote-SSH 后续可通过既有 adapter/port 抽象加入。
4. 降低 vibe coding 过程中因“顺便做跨平台/远程”造成的范围膨胀。

## Architecture constraint
当前仍保留：
- ExecutionWorkspace
- PlatformAdapter
- ProcessRunner
- EnvironmentSnapshot
- FileSystemPort
- GitPort
- RuyiPort

未来 Remote 支持不得要求重写 Agent Core。
