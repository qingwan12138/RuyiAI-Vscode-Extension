# ADR-0012 — Headless / CI 运行入口

## Status
Accepted

## Decision
新增**无编辑器的运行入口**：`runHeadlessTask()`（编程接口）与 `yisi-headless` CLI。同一个 Agent 核心（同一批工具、同一个 `PermissionEngine`、同一套审阅路径）在没有 VS Code 的环境里运行。

```
yisi-headless --root ./project "总结这个项目怎么构建"
yisi-headless --root ./project --allow-write "修掉失败的测试"
```

### 审批策略（本 ADR 的核心）
没有人坐在键盘前，因此"谁来回答引擎的问题"必须由调用方**显式**决定：

| 配置 | 模式 | 结果 |
|---|---|---|
| **默认**（无开关） | `plan` | **只读**：一切改状态的动作被引擎拒绝，且**没有审批通道** |
| `--allow-write` | `manual` + 允许清单审批器 | `workspaceWrite` / `processExec` / `environmentChange` 自动批准 |
| 任何配置 | — | **`destructive` / `credentialSensitive` 永远没有通道**（失败关闭） |

三条不可动摇的规则：

1. **安全的情形就是默认的情形**：默认只读，不需要信任任何东西。
2. **写权限必须显式开启**，且开启后仍走 `manual`（**不是** `acceptEdits`）——这样审批器真的会被问到，允许清单才有意义。
3. **人对不了的事，CI 开关也不能批**：`destructive` / `credentialSensitive` 不在可允许集合里；审批器对未列出的风险类**抛出**（loop 已有语义把它映射为 `unavailable` 失败关闭）。报"用户拒绝了"是对一次**没有用户**的运行说谎。

`plan` + `--allow-write` 是**矛盾配置**，直接报错而不是静默忽略其中一个。

### 与编辑器版本的关系
- **同一套工具**：读/搜/索引/项目探测/命令/验证/编辑/Ruyi/skills/子代理/计划表全部可用。
- **明确缺少**：依赖语言服务器的工具（`list_symbols`）与编辑器空闲 diagnostics 快照——CI 容器里没有语言服务器可问。这一条如实记录，不用空实现凑数。
- **上下文完整**：项目指令（`AGENTS.md` 家族）与 skill 目录照常注入，权限简报照常在尾部。
- **退出码区分"失败"与"用错"**：`0` 完成、`1` 任务停止（原因打印到 stderr）、`2` 参数或环境错误。CI 必须能分辨"agent 说不行"和"你调用错了"。
- **密钥只从环境变量读**：`--api-key-env` 指定变量名，**禁止**把密钥放在命令行参数里（会进 shell 历史与进程列表）。

## Reasons
1. 这是 CI 与 SDK 的共同地基：能编程跑一次任务，才能接 CI、才能给外部调用。
2. 有了它，"Agent 核心不依赖 VS Code"从**架构声明**变成**可被测试证明的事实**——端到端用例在一个真实临时目录上跑真实工具并把改动落到磁盘。
3. 审批策略必须为无人场景单独设计，而不是复用交互式默认值：默认只读 + 显式 opt-in + 两类永久失败关闭，是这里唯一诚实的组合。

## Consequences
- 未实现（明确记录，非遗漏）：**流式 JSON 事件输出**（当前 `--json` 只在结束时输出一次结果）、会话持久化（一次运行一个临时会话）、并发的多任务编排、把 CLI 打进 VSIX 的 `bin` 入口（当前是源码内可调用的入口）。
- 本机未验证：用**真实 HTTP provider**跑一次（测试全部使用脚本化 provider，避免联网）；以及 CI 容器里的真实表现。
- 联网（web search/fetch）**仍然未做**：它卡在 `docs/14` 的产品/法务决策上，与本 ADR 无关。

## Verification
`test/headless.test.js`（14 个）：
- **策略**：默认 `plan` 且无审批通道；opt-in 后模式为 `manual` 且确有审批器；`destructive`/`credentialSensitive` 无法被允许；`plan` + 允许清单报错；**审批器按风险类回答，未列出的类抛错**（映射为失败关闭）。
- **参数**：prompt 必需、`--root`/`--model`/`--json`/`--mode=` 解析、未知模式报错、`--allow-write` 即 opt-in。
- **端到端（无 VS Code，真实目录）**：默认运行**不能**创建文件（模型收到 `reason: 'policy'`）；opt-in 后**真的把文件写到磁盘**；项目指令与 skill 目录确实进入请求头部、权限简报仍在尾部；无法推进的运行以 `status: 'blocked'` + 原因返回而不是抛异常。
- **CLI**：坏参数/缺密钥 → 退出码 2；完成任务 → 0 并打印回答；被停止 → 1 且 stderr 有原因；`--json` 输出可解析的单个结果对象。

全量：**643 tests / 642 pass / 0 fail / 1 skip**（Plan 审阅那一项时为 629）。

## 开发过程中的两次真实纠错
1. **审批器曾经批准一切**：初版用 `request.reason.length > 0` 判断，而 `ToolConfirmationRequest` 里**根本没有风险类**，于是 `destructive` 也会被"允许"。修法不是把判断写复杂，而是**把 `risk` 加进审批请求**（循环本来就知道），审批器按风险类回答，未列出的类抛错。
2. **布尔开关吞掉了 prompt**：`--json "do it"` 被解析成"`--json` 的值是 `do it`"，于是报"缺少 prompt"。修法是显式列出**不取值的开关**——这正是"参数解析要能测"的原因。
