# 07 — Security, Permissions & Privacy

## Permission modes
- Plan：读/搜索/分析；禁止状态修改。
- Manual：读自动；写文件/命令等按策略确认。
- Accept Edits：文件编辑可自动；命令和高风险动作仍评估。
- Auto：安全读写/构建测试可自动；高风险仍 ask/deny。
- Full Access：显著高风险模式；减少确认但仍保留审计与硬安全边界。

Permission mode 不是 sandbox。Sandbox/ExecutionWorkspace 决定技术上能访问哪里；PermissionEngine 决定是否需要用户批准。

每次 Agent 运行都会收到一份**权限模式简报**（`application/agent/permissionModePrompt.ts`）说明当前模式允许什么、被拒之后该怎么做。它插在**保留历史之后、当前用户轮之前**，而不是会话首条——这样历史保持逐字节稳定的可缓存前缀，模式变化只改尾部（Anthropic 传输会把 system 消息上提到顶层 `system` 字段，那里仍会影响缓存前缀，属已知代价）。起因：模型原先完全不知道自己处于哪个模式，于是在 Plan 模式下直接尝试写文件、被引擎拒绝、整轮以红色错误结束，而不是给出方案。

**简报只是告知，不是开关。** 它不参与任何判定：每次 tool call 仍无条件经过 `PermissionEngine`。即使模型被仓库文本说服"我现在是 Full Access"，引擎照样按会话的真实模式拒绝——这正是"不因为文件里写了忽略权限就绕过 policy"的落地方式。简报的措辞必须与 `PermissionEngine.evaluate` 保持一致，`test/permission-mode-prompt.test.js` 用真实引擎做耦合校验（模式判定变了而措辞没变 → 测试失败）。措辞**不得**写成"不要尝试"：DSH 记录过这种禁止式框架会导致 **soft lockout**（模型不再尝试"被拒但可升级"的工作、出现零工具调用的空转）。现在是"照常尝试、读拒绝结果、不要绕过"。

## 被拒 = 工具结局，不是运行失败

一次被拒的调用**不会终止整轮**（参照 docs/04 的三家收敛：CC / Codex / DSH 都把拒绝作为单次调用的结局回给模型，运行继续）。`AgentToolLoop` 把拒绝写成一条 `role: 'tool'` 的结果：

```json
{ "ok": false, "denied": true, "reason": "policy | user | unavailable", "error": "…", "guidance": "…" }
```

三种 `reason` 必须**可区分**，否则模型无法判断该改策略、该换方案、还是该请用户开通道：
- `policy`：`PermissionEngine` 拒绝（如 Plan 模式）。
- `user`：用户点了"拒绝"。**不要重复该请求**，应询问用户想要什么。
- `unavailable`：没有可用的审批通道（未接线 / 审批无法完成）→ 动作失败关闭，同样回给模型。

**继续是有界的**：连续 3 次或单轮累计 20 次拒绝后停止并把控制权交回用户（`maxConsecutiveDenials` / `maxTotalDenials`）。阈值取自公开记录：Claude Code 为连续 3 / 累计 20，Codex 为连续 3 / 最近 50 内 10。**运行终止只保留给协议级违规**：未知工具、超出有界工具范围、重复调用无进展、轮次或预算耗尽。区分很重要——**策略拒绝是"约束生效"，不是"运行失败"**；把两者混为一谈会让用户以为插件崩了。

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
