# 07 — Security, Permissions & Privacy

## Permission modes
- Plan：读/搜索/分析；禁止状态修改。
- Manual：读自动；写文件/命令等按策略确认。
- Accept Edits：文件编辑可自动；命令和高风险动作仍评估。
- Auto：安全读写/构建测试可自动；高风险仍 ask/deny。
- Full Access：显著高风险模式；减少确认但仍保留审计与硬安全边界。

Permission mode 不是 sandbox。Sandbox/ExecutionWorkspace 决定技术上能访问哪里；PermissionEngine 决定是否需要用户批准。

每次 Agent 运行都会收到一份**权限模式简报**（`application/agent/permissionModePrompt.ts`，作为会话首条 system 消息）说明当前模式允许什么、被拒之后该怎么做。起因：模型原先完全不知道自己处于哪个模式，于是在 Plan 模式下直接尝试写文件、被引擎拒绝、整轮以红色错误结束，而不是给出方案。

**简报只是告知，不是开关。** 它不参与任何判定：每次 tool call 仍无条件经过 `PermissionEngine`。即使模型被仓库文本说服"我现在是 Full Access"，引擎照样按会话的真实模式拒绝——这正是"不因为文件里写了忽略权限就绕过 policy"的落地方式。简报的措辞必须与 `PermissionEngine.evaluate` 保持一致，`test/permission-mode-prompt.test.js` 用真实引擎做耦合校验（模式判定变了而措辞没变 → 测试失败）。

## Risk classes
建议：read-only, workspace-write, process-exec, network, environment-change, destructive, credential-sensitive。Ruyi install/venv create 属 environment-change；uninstall/repo remove 更高风险。

## Secret
API Key/OAuth/refresh token/gateway token → SecretStorage。Provider/model/base URL 可普通配置。支持环境变量引用但只存变量名。禁止 secret 出现在日志、session、webview state dump、crash report。

## Privacy
会话/工具历史/计划/diff 默认只本机。只有构建当前 provider 请求所需内容才发送到模型 endpoint。未来 telemetry 必须 opt-in 或符合甲方明确要求；本阶段不要默认上传源码/会话。

## Webview security
CSP、nonce、`localResourceRoots` 最小化；所有来自 Webview 的消息做 runtime schema validation；Webview 不持有 API Key。

## Prompt injection / tool safety
把仓库文本视为不可信数据，不因为文件中写了“忽略权限/执行命令”就绕过 policy。Tool call 永远经过 schema + PermissionEngine。
