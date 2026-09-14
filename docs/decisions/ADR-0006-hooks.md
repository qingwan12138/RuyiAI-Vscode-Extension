# ADR-0006 — Hooks（生命周期脚本）

## Status
Accepted

## Decision
Yisi AI 支持**用户配置的 hook 脚本**，在工具调用前后运行。配置在 `yisiAI.hooks`。

支持的事件（本切片）：

| 事件 | 时机 | 能做什么 |
|---|---|---|
| `preToolUse` | 工具解析与 bounded scope 检查之后、**PermissionEngine 判定之前** | 打印 `{"decision":"deny","reason":"…"}` **阻止**这次调用；或给出 `context` |
| `postToolUse` | 工具执行之后（成功或失败都跑） | 输出文本/`context`，附加到模型读到的工具结果里 |

### 核心不变式：hook **只能收紧**

- 决策词汇只有 `allow`（无异议）与 `deny`（阻止），**没有"批准"这个值**。因此任何 hook、任何配置都**无法**让一个动作变得"更被允许"。
- `allow` **不等于放行**：它只是"没有异议"，随后 `PermissionEngine` 与审批卡片照常运行，与没有 hook 时完全一致。
- 因此 hook 不可能成为绕过权限模型的通道；仓库里带一份 `.vscode/settings.json` 也无法放宽闸门。
- **这是与参考实现的刻意差异**：CC 的 hook 返回 allow 可以**抑制**权限提示，Yisi 不做这条（`AGENTS.md §2`：只有 PermissionEngine 决定）。

### 拒绝语义

- hook 拒绝使用**独立的拒绝理由 `hook`**，与 `policy` / `user` / `unavailable` 并列。
- **hook 拒绝不计入 `policyDenials`**，因此**不会**解锁 `request_permission` 一次性升级——放宽模式永远解不开 hook，让模型去申请升级只会浪费一轮。模型收到的指引明确写出这一点。

### 失败语义（明确、可选、可见）

- hook 无法运行时（spawn 失败、超时、输出不合法、非零退出）按每个 hook 自己的 `onError` 处理：
  - **`preToolUse` 默认 `block`**：一个"悄悄不再守门"的护栏比"挡住动作"更糟；
  - **`postToolUse` 默认 `continue`**：它只补充上下文，失败不该阻断工作；
  - 两种情况下**失败都必须可见**（作为拒绝原因，或作为附加上下文），绝不静默吞掉。
- 超时（默认 10s，可配，上限 120s）与取消都会**终止进程**并保证 promise 落定——卡住的 hook 不能把一次 Agent 运行挂死。
- **Stop 优先于 hook 结论**：取消后 loop 立即 `throwIfAborted()`，不会把"取消"伪装成一次护栏拒绝。

### 进程与输出契约

- `spawn(command, args, { shell: false })`：**精确 argv，不是 shell 命令串**。这是与 CC 的又一处刻意差异（CC 用 shell 字符串），与 `AGENTS.md` 的机器可判定命令规则、以及 `ProcessRunner`/MCP 传输保持一致，同时避免引号与注入问题。
- 事件负载以 **JSON 写入 stdin** 后 EOF；**stdout** 为空、或 `{decision?, reason?, context?}`。
- **`postToolUse` 允许纯文本输出**（"跑 linter 并打印结果"是最自然的用法）；**`preToolUse` 必须输出 JSON 或什么都不输出**，因为决策需要结构，猜散文比拒绝猜更糟。
- 未知的 `decision` 值（例如 `"approve"`）是**错误**，不是放行。
- stdin/stdout/stderr 全部有界；stderr 有界保留并进入失败原因；Linux 下按进程组终止（docs/16）。

## Reasons
1. `AGENTS.md` / 项目指令是**请求**，不是**保证**；hook 是唯一能真正**强制**的机制（参考文档原话：要每次都成立就必须是 hook 而不是 prompt 指令）。
2. `postToolUse` 把"改完跑 linter 并把结果喂回去"变成一个用户可控的确定性步骤，而不是靠模型自律。
3. 只做两个事件、只做"收紧"，是因为这两个事件的价值最高，且它们与权限模型的交互最需要设计对；其余事件（SessionStart/UserPromptSubmit/Stop/PreCompact）不触及执行路径，可以后续独立添加。

## Consequences
- 每个匹配的 hook 都是**一次进程启动**：`preToolUse` 匹配所有工具时，每次工具调用都会多一次进程开销。用户可以用 `match` 收窄。
- hook 进程以执行根为工作目录（worktree 会话看到自己的 checkout），并继承环境。
- **明确未做**（非遗漏）：`SessionStart`/`UserPromptSubmit`/`Stop`/`PreCompact` 等事件、HTTP/Webhook 型 hook、prompt 型 hook、子代理 hook、hook 的 UI 管理面板与启用/禁用开关、hook 输出进入会话历史的持久化。
- 本机未验证：VS Code 内 F5 用真实 `.vscode/settings.json` 配置 hook 的端到端体验。

## Verification
- `test/hooks.test.js`（18 个）：配置解析的全部拒绝路径与默认值（**pre 默认 block**）、工具匹配（精确 / 命名空间通配 / 元字符按字面量）、服务层的顺序与短路边、失败策略两种取值、post 的 deny 退化为 context、取消不被伪装成拒绝；**经真实 Agent loop**：hook 拒绝作为 `reason: 'hook'` 的工具结局且工具未执行、**hook 拒绝不解锁权限升级**（`request_permission` 仍被判 `policy` 且用户从未被询问）、**hook allow 不免除 Manual 的审批**（无通道则 `unavailable`，有通道则照常弹卡）、hook context 前后都进入模型可见的结果、无 hook 时行为与之前完全一致；组合根接线与 manifest 声明守卫。
- `test/hooks-process.test.js`（14 个，真实子进程）：stdin JSON 完整送达、deny/allow/空输出、纯文本在 post 是 context 而在 pre 是错误、畸形输出与数组输出是错误、**未定义决策是错误而不是放行**、非零退出带上 stderr、**超时被真正兜住并终止进程**、取消终止进程、已取消时不启动进程、可执行文件缺失、服务层 + 真实 executor 的端到端拒绝与默认阻塞。
- 全量：**559 tests / 558 pass / 0 fail / 1 skip**（MCP 那一项时为 527）。

## 开发过程中的两次真实纠错
1. 集成测试里 `executions` 用了本地空数组而不是 `result.executions`，断言读到 `undefined`——**测试写错了**，已改为读取循环真实返回的证据。
2. "非零退出"的断言写成 `/exit code 3/`，实现的实际文案是 `the hook exited with code 3: …`——文案本身正确且带 stderr，改断言。
