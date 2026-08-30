# 02 — Architecture Contract

## 1. 总体分层

```text
RuyiSDK Host Extension (single VSIX)
│
├─ Existing RuyiSDK features
│
└─ Yisi AI feature package
   ├─ Presentation / VS Code Adapter
   │  ├─ Webview UI
   │  ├─ Commands / Selection / Diagnostics adapters
   │  └─ VS Code lifecycle
   ├─ Application
   │  ├─ SessionService / TurnService
   │  ├─ AgentRuntime
   │  ├─ ContextOrchestrator
   │  ├─ ToolOrchestrator
   │  └─ ValidationOrchestrator
   ├─ Domain
   │  ├─ Session / Turn / AgentRun
   │  ├─ Tool contracts
   │  ├─ Permission policy
   │  ├─ Provider contracts
   │  └─ ExecutionWorkspace contracts
   └─ Infrastructure
      ├─ LLM provider adapters
      ├─ filesystem/search/process/git adapters
      ├─ RuyiCliAdapter
      ├─ SecretStorage adapter
      └─ local persistence
```

## 2. 强制依赖方向

- Domain 不 import `vscode`。
- Domain 不 import OpenAI/Anthropic/DeepSeek SDK。
- AgentRuntime 只认识 `LLMProvider`, `Tool`, `PermissionEngine`, `SessionRepository`, `ExecutionWorkspace` 等 port。
- Webview 只通过 typed message protocol 与 Extension Host 通信。
- Ruyi Core 只认识 `RuyiPort`；`RuyiCliAdapter` 实现它。
- 上游 `ruyisdk-vscode-extension` 内部类不能成为 Yisi domain/application 的依赖。

## 3. Integration seam

最终合并上游时尽量只需：
1. activation entry 调 `registerYisiAI(context, optionalHostBridge)`；
2. package.json 增加固定 contributions；
3. optional bridge 做 UI refresh / host command soft integration。

上游内部命令（例如 refresh）只能 `tryExecute`；不存在时不得导致 Yisi 核心失败。

## 4. 推荐目录（目标态）

```text
src/yisi/
  domain/
    session/ permission/ tools/ llm/ workspace/
  application/
    agent/ context/ validation/ conversation/
  infrastructure/
    llm/ process/ filesystem/ git/ persistence/ ruyi/
  vscode/
    activation/ commands/ diagnostics/ selection/ terminal/ webview/
  shared/
    protocol/ errors/ logging/
webview-yisi/
  src/components/ state/ protocol/
```

## 5. 关键端口

- `LLMProvider`: stream/chat/model discovery/capabilities/tool protocol normalization
- `Tool`: schema + risk metadata + execute
- `PermissionEngine`: tool proposal → allow/ask/deny
- `ExecutionWorkspace`: current workspace / isolated worktree
- `ProcessRunner`: 可捕获 stdout/stderr/cancel 的非交互执行
- `InteractiveTerminalBridge`: 交互式命令的 VS Code Terminal 桥
- `SessionRepository`: 本地持久化
- `SecretStore`: secret CRUD
- `RuyiPort`: 稳定 Ruyi 领域操作
- `ValidationProvider`: diagnostics/build/test/lint/typecheck/domain validation

## 6. 不要过度抽象

只有出现第二个真实实现或明确替换需求时再引入复杂工厂/插件系统。Provider/Storage/Process/Ruyi 由于从需求上已经明确多实现或边界稳定，可从第一天用 port/adaptor。
