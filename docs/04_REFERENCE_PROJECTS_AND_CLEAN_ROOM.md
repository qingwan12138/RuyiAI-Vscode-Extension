# 04 — Reference Projects & Clean-Room Rule

## 核心原则

Yisi AI 是闭源横向交付。**“参考开源项目” = 研究公开行为、架构概念、UX 和问题拆分，不等于复制源代码。** 即使某仓库许可证允许闭源再分发，也不代表本项目应该直接搬代码；合同/IP 边界优先采用 clean-room 自研。

## 参考矩阵

### Claude Code（Anthropic）
参考：
- session 持续对话、中断后继续、权限/批准体验
- agentic terminal workflow、工具使用反馈闭环
- worktree 并行工作的产品思想
- hooks/rules 等可扩展产品概念（后期）
不参考/不复制：
- 未公开内部实现、系统提示词、私有协议、品牌/视觉资产
- 不假设其 GitHub 仓库等于完整产品源码

### OpenAI Codex
参考：
- Thread/Turn/Agent loop 的生命周期思想
- 多线程/并行 Agent + worktree 隔离
- edit → test/lint/typecheck → feedback loop
- 持久化 thread、resume/fork/archive 等产品语义
不复制：
- Codex Rust/CLI/app-server 具体实现代码、prompt、品牌 UI
- 不把 Codex API/模型作为 Yisi 核心硬依赖

### Cline
参考：
- VS Code Extension Host + Webview 的职责拆分
- controller/task/provider/tool 的工程模块化思路
- multi-provider 与 SecretStorage 的工程问题
- permission/tool result 在聊天流中的呈现方式
不复制：
- React 组件、Controller/Task 类、消息协议、prompt、工具实现等源码
- 不 fork 后改名

### Roo Code / Kilo 类产品
参考：
- mode / permission / tool group / MCP / subagent 等后期产品方向
- 多 Provider UX 与可配置性
不复制具体模式定义、UI、prompt、实现。

### Aider
参考：
- repository map：用符号/关键定义提供仓库级轻量上下文
- git-aware diff、lint/test feedback、context budget 思路
- “按需上下文”而非把仓库全部塞进 prompt
不复制 repo-map 算法代码；Yisi 可用 VS Code symbol APIs / tree-sitter 等自研实现。

### Continue
参考：
- IDE protocol / UI 与 core 分离的思想
- VS Code 适配层与跨宿主 core 的边界
注意：只作为历史/工程参考，不作为必须跟随的产品基线。

## Clean-room 工作流

1. 写“行为需求”：例如“Session Stop 后可继续”。
2. 写 Yisi 自己的接口/状态机/测试用例。
3. 关闭参考源码后独立实现。
4. Code review 检查命名、结构、字符串、prompt 是否出现大段相似。
5. 如果真的引入第三方包，必须进入 `THIRD_PARTY_NOTICES.md` 与 dependency audit。

## 许可证不是“复制许可证”

Apache-2.0/MIT 等许可证可能允许商业闭源组合，但会带来 attribution/NOTICE/修改声明等义务；GPL/AGPL 等强 copyleft 依赖默认禁止进入交付物，除非甲方/法务明确批准。许可证判断必须以引入时锁定版本的 LICENSE 为准。

## 参考记录模板

每次外部研究只记录：
- project + URL + date/version/commit
- observed behavior / architectural idea
- Yisi requirement derived
- “No source copied”

不要在仓库里保存第三方源文件作为“参考”。

---

## 参考记录：审批 / 权限模型（2026-09-14）

目的：弄清 Codex / Claude Code / DeepSeek Harness 各自如何处理"哪些动作要问、被拒之后怎么办"，据此调整 Yisi。**只研究公开文档描述的行为与设计，未复制任何源码、prompt 或品牌资产。**

### DeepSeek Harness（`@deepseek-ai/dsh` 0.1.5-rc.1）

来源：本机安装包内各插件自带的公开 README（`node_modules/@deepseek-ai/dsh-{permission-presets,user-approval,sandbox-policy,plan-mode,client-ui-approval}/README.md`），以及 https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart 。日期 2026-09-14，版本 `0.1.5-rc.1`。

观察到的行为 / 架构思想：
1. **两个正交的旋钮**，而不是一个滑杆：*sandbox mode*（文件效果，`read-only` / `workspace-write` / `danger-full-access`，缺省 `read-only` 失败安全）与 *approval policy*（`ask` / `never`，缺省 `ask`）。sandbox 明确只管文件效果，网络与进程不在其词汇内（列为已知限制）。
2. **用户界面只有一个选择器**：*permission presets* 把 sandbox + approval 打包成命名预设（`workspace-write` = {sandbox: workspace-write, approval: ask}）。当两个旋钮的组合不匹配任何预设时显示派生的 `custom`（只读展示，不可选中/持久化）。
3. **被拒不是运行失败，而是工具结果**：模型看到的是允许/拒绝/取消/不可用这几种**工具结局**；"a rejection may replace a normal tool result with a small retained error"。`ask` 无可用应答者时解析为 `unavailable` → 动作失败关闭（fail closed），但**对话继续**。
4. **模型会被告知当前策略**：`approval:policy` 与 `sandbox:policy` 作为运行时上下文快照注入；策略变更时**在保留历史之后追加一份新的完整快照**，而不是改写稳定前缀——理由是 KV cache 稳定性（"The stable system prompt remains byte-identical across mode changes"）。
5. **plan mode 不是强制机制，只是引导**："It does not restrict the agent: every tool stays callable"；"Guidance, not enforcement"。真正的限制由 sandbox 与 approval 负责。plan 通过一个 prompt section 注入引导文本（first-party prompt order 500）。
6. **plan 有一个"被审阅的退出"**：agent 用专门的 `exit_plan_mode` 工具提交 markdown 计划，用户选 **Approve**（离开 plan 模式）或 **Keep planning**（带反馈打回）。该工具在两种状态下都注册，因此进出 plan 只改 prompt section、不改工具目录（同样是 KV cache 考量）。无交互通道时该调用失败关闭，`/plan off` 仍是手动出口。
7. **只读策略鼓励"先试再说"**：read-only 的策略文本明确告诉模型 *"Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns."*
8. **审批只能一次性**：结局词汇含 `allowed-once`，但**没有 allow-always、没有记忆规则、没有撤销、没有 grant store**；客户端 UI 也只暴露 allow-once 与 reject。

由此推导的 Yisi 需求（**独立实现，不复制**）：
- Y-1：策略拒绝与用户拒绝都应作为**工具结局**回给模型，而不是终止整轮；终止只保留给协议级违规（未知工具、超出有界范围、重复调用、预算耗尽）。
- Y-2：模型必须知道当前模式（Yisi 已做：`permissionModePrompt.ts`），但措辞应改为"正常尝试、按拒绝指引调整"，因为拒绝在 Y-1 之后不再致命；plan 模式例外，仍以"先给方案"为主。
- Y-3：Yisi 的单选择器方向**与 dsh 的 preset 一致**，无需拆成两个旋钮暴露给用户。
- Y-4：Yisi 目前**没有** dsh 意义上的第二根轴（只有 worktree 隔离，不限制文件效果）；是否引入 `read-only` 这类技术边界需另行决策。
- Y-5：plan 模式缺"被审阅的退出"——值得补一个提交计划并请用户批准的出口。
- Y-6：审批卡片一次性（Approve / 拒绝）**已与 dsh 对齐**，不需要加"总是允许"。

未复制任何源码、prompt 文本或 UI 资产；上表中的英文引文取自公开 README 以佐证行为，Yisi 的实现将自行撰写措辞与结构。
（注：研究过程中子代理另写过一份 444 行的详细报告到 `docs/research/`，已按 clean-room 流程删除——第 3 步要求"关闭参考源码后独立实现"，把参考方的详细设计描述留在实现旁边正是该流程要避免的；此处只保留行为级记录。）

### OpenAI Codex（`codex-rs`，2026-09-14）

来源：官方文档站点（`learn.chatgpt.com/docs/*`，原 `developers.openai.com/codex/*` 已重定向）、以及 `openai/codex` 各历史 tag 的公开 README/文档（`rust-v0.2.0` / `v0.10.0` / `v0.30.0`——旧命名只在这些 tag 里有记录）。行为描述，未复制代码或 prompt。

观察到的行为 / 架构思想：
1. **两根轴，且官方明确解释为什么分开**：sandbox 定义**技术边界**，approval policy 决定**何时必须停下来问**。原文立场：sandbox 存在的理由之一就是**缓解审批疲劳**，让信任模型建立在"被强制的限制"而非"模型的意图"上。
2. **approval 取值**（现状）：`on-request` | `never` | `granular{…}`；`untrusted` 已**不支持**、`on-failure` 已**废弃**。另有独立键 `approvals_reviewer`（谁来看，不改变 sandbox）。历史命名链：`suggest`/`auto-edit`/`full-auto` → `untrusted`/`on-failure`/`on-request`/`never` → 现状。
3. **sandbox 取值**：`read-only` / `workspace-write` / `danger-full-access`。`workspace-write` 下**网络默认关闭**（需显式开启）；`.git`、`.agents`、`.codex` 递归只读（因此 `git commit` 可能需要升级）。**不可强制时失败关闭**——"refuses to run the command instead of silently running it unsandboxed"（拒绝执行，而不是偷偷不加沙箱地执行）。
4. **拒绝是"单个条目的终态"，不是会话失败**：条目以 `completed | failed | declined` 结束，**理由回给模型**，对话继续。自动审查的拒绝额外附带"不要绕过、只在有实质更安全替代时才继续，否则停下来问用户"。另有**每轮熔断**：连续 3 次拒绝、或最近 50 次审查中 10 次拒绝 → 中断本轮。
5. **升级是结构化请求**：携带 reason、命令、cwd、可见的决策集（accept / acceptForSession / decline / cancel / acceptWithExecpolicyAmendment），客户端**只返回被授予的子集**，作用域默认 `turn`（可选 `session`）。网络授权按目标（host/protocol/port）分组，一次提示可放行多个排队请求。
6. **命令级规则**：`prefix_rule(pattern, decision, …)`，decision = `allow`（免问、沙箱外执行）/ `prompt` / `forbidden`，**最严者胜**（forbidden > prompt > allow）；精确前缀匹配；`bash -c` 线性链会被拆成逐条评估（防止把危险命令夹带在允许命令旁边），带重定向/替换/glob/控制流时整条保守评估。**记住的允许写进用户级规则文件，且写入前展示规则给用户确认**。
7. **UI**：权限控件在**composer 下方**；`/permissions`（选择器）、`/status`（显示当前 approval policy 与可写根）、`/debug-config`；启动时对 git 仓库推荐 Auto（workspace-write + on-request），否则 read-only。
8. **官方自陈的坑**：审批疲劳是"沙箱存在的理由"；通配 allow 规则太宽；**"审批提示显示的是命令字符串，而不是它真正能触达什么"（审批提示不是沙箱）**；`.git` 只读导致 `git commit` 升级令人困惑；网络开启但无代理 = 无限制出站且域名规则失效。

由此推导的 Yisi 需求：见下方"三家收敛"。

### Claude Code（Anthropic，2026-09-14）

来源：官方文档 `code.claude.com/docs/*`（Claude Code 文档现址）、Anthropic 官方工程博客、以及 `github.com/anthropics/claude-code` 的 issue **标题**（正文因 API 限流未能读取，仅作线索）。行为描述，未复制 prompt、代码或品牌资产。

观察到的行为 / 架构思想：
1. **六个模式**（不是四个）：`default`（UI 标签 Manual）/ `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions`。官方框定为"便利与监督之间的不同取舍"。`dontAsk` 是**锁定型 CI 档**：任何本会询问的动作直接**拒绝且不等待**；`bypassPermissions` 有几道硬门槛（root/sudo 下拒绝、需一次性责任确认弹窗、管理员可禁用、无法从非 bypass 会话中途进入）。
2. **模式不进 system prompt**：官方明确"Switching between permission modes … does not change the system prompt or tool definitions, so mode changes are cache-safe"，plan 模式等指令是**以对话消息追加**的。**执行与模型无关**："Permission rules are enforced by Claude Code, not by the model."
3. **模型被告知的是"结局"而非"模式名"**：拒绝会把原因回给模型；`PermissionDenied` 钩子的 `retry: true` 用来"告诉模型它可以重试那次被拒的调用"；无头 `--permission-prompts none` 下明确告知"没人能批准、不要重试"。
4. **拒绝 = 反馈而不是失败**（engineering 博客 *Deny-and-continue* 一节）：拒绝作为**工具结果**返回，并附带"按善意对待这条边界：找更安全的路，不要绕过它"。理由是**让误判可承受**——"a false positive costs a single retry"。
5. **终止是例外，且有阈值**：交互式"拒绝且**不给评论**"会停轮（**给了评论**则评论作为拒绝原因、模型继续）；prompt 型 hook 拒绝默认停轮，除非 `continueOnBlock: true`；**连续 3 次或累计 20 次拒绝 → 停下升级给人**，无头模式（无人在场）直接终止进程。
6. **优先用结构性信号**：**裸工具名的 deny 规则会把该工具从模型上下文里彻底移除**——"Claude never sees it"，模型根本无法尝试；其余才靠拒绝反馈。
7. **plan 有专用工具**：`EnterPlanMode`（permission: No）与 **`ExitPlanMode`（permission: Yes）**；批准弹窗的**每个选项都携带后果**（"Yes, and use auto mode" / "Yes, manually approve edits" / "No, keep planning"），"Approving a plan exits plan mode and **switches the session to the permission mode each approve option describes**"。
8. **plan 不是硬沙箱**（官方自陈 + 3 个用户 issue）：当 bypass 可用时"Claude Code also doesn't enforce plan mode's blocks"，只是**指示**模型不要编辑，实际写入不会被拦。
9. **规则优先级**：`deny` > `ask` > `allow`，且 deny **在所有模式下都生效（含 bypassPermissions）**，allow 在 bypass 下无效；plan 模式下写入**永不**被 allow 规则自动批准；受保护路径（`.git`/`.vscode`/`.npmrc`/shell rc 等）的写入不能被 settings 里的 allow 规则预先批准；`rm`/`rmdir` 命中关键路径时**任何 allow 规则与 hook 都不能放行**（明确的"防模型犯错"断路器）。
10. **自陈的坑**：审批疲劳是功能存在的理由（官方数据：**93% 的提示被批准**、分类器对真实越权动作的**漏报率 17%**）；`acceptEdits` 名字比实际窄——它连 `rm`/`mv`/`cp`/`sed` 都自动放行；文件修改类批准**只持续到会话结束**而 Bash 类按仓库持久（易记错）；"don't ask again"的**持久化写回路径是官方 tracker 上被反复报告的最弱环节**（5 个 issue）。

由此推导：见下方"三家收敛"与"结论"。

### 三家收敛（DeepSeek Harness / Codex / Claude Code）

| 维度 | 三家的一致结论 |
|---|---|
| **被拒之后** | **三家一致：拒绝是"单次调用/单个条目"的结局回给模型，运行继续**。（CC 原文："Claude shouldn't halt and wait for input; it should recover and try a safer approach where one exists."） |
| **必须有界** | **三家一致：继续但要有限额**。CC：连续 3 次或累计 20 次 → 停下升级给人（无头模式直接终止进程）；Codex：连续 3 次或最近 50 次内 10 次 → 中断本轮；DSH：同一轮内**仅一次**、且必须"有据可依 + 严格更宽 + 人来批"的升级重试。 |
| **要有恢复路径** | DSH：**没有恢复路径的拒绝是死路，会逼用户全局放开更宽的档位，反而毁掉沙箱**。CC/Codex 同样把拒绝与一次升级/重试配对。 |
| **模式是否进 system prompt** | **CC 与 DSH 都明确：不进**。CC 理由是 cache 安全（"mode changes are cache-safe"），指令以**对话消息追加**；DSH 除 cache 外还记录了**实证教训**——早期放进 system prompt 导致"soft lockout"（模型不再尝试"被拒但可升级"的工作、出现零工具调用的空转）。Codex 未见文档。 |
| **执行与模型分离** | 三家一致：**执行在宿主侧，模型只被告知结局**。CC 原文："Permission rules are enforced by Claude Code, not by the model." |
| **两根轴 vs 一个滑杆** | Codex 与 DSH 都是**两根独立的轴**（技术边界 + 何时问），但**都再打包成一个用户可见的选择器**；CC 是"模式设基线 + 规则表叠加"。→ **Yisi 的单选择器 5 档方向正确，但缺一个正交的技术边界轴。** |
| **结构性信号优先** | CC：完全拒绝的工具**直接从工具表移除**，模型看不到、无法尝试（比"尝试后被拒"更明确）。 |
| **allow-always** | DSH 没有（存储/作用域/撤销未设计）；Codex 有（前缀规则、持久、写入前给用户看）；CC 有（allow/ask/deny 表）——**但 CC 的持久化写回正是被报告最多的 bug 区**。 |
| **plan 模式** | DSH：plan **只是引导、不是强制**，有"被审阅的退出"工具；CC：有 `EnterPlanMode`/`ExitPlanMode`，批准时**选项携带后果**（切到哪个模式），且官方自陈**在 bypass 可用时 plan 不是硬沙箱**；Codex：无 plan 概念。 |

### 结论：Yisi 的三个真正缺口

1. **拒绝太致命**（三家共识的反面）：策略拒绝与用户拒绝都终止整轮，模型既不知情也无法给替代方案；且没有拒绝预算。
2. **模式简报的位置与措辞与两家实证相悖**：Yisi 现放在会话首条 system 消息，且对 plan 写"不要尝试"——正是 DSH 记录过的 soft-lockout 形态。
3. **Yisi 的 `plan` 把两个概念混在一起**：它既表示"先计划再动手"（协作模式），又用硬拒绝充当"只读"（执行级别）。CC 与 DSH 都把两者分开——这正是用户"选 Plan 问一句话却拿到红色报错"的根因。

**实施进度**：缺口 1 与 2 已由 T1 修复（拒绝变为可区分的工具结局 + 连续 3/累计 20 的拒绝预算 + 简报移到历史之后并改为"照常尝试、读拒绝结果"）。**缺口 3 已由 T2/T3 修复**：新增 `request_permission` 一次性权限升级（有据可依 + 严格更宽 + 每次运行仅一次 + 人来批 + 只对本次运行生效），它**同时充当 Plan 模式的"被审阅的退出"**——模型给出方案后请求切到可写模式，用户在同一张审批卡片上批准。**仍明确未做**（附理由，不是遗漏）：(a) **OS 级沙箱轴**——Yisi 的强制点在工具闸门而非内核；引入 native 沙箱违反 docs/17 的"默认禁止 native addon / 第二套运行时"，且三个参考实现都靠平台机制（Seatbelt/bwrap/Landlock/Windows ACL/内核），VS Code 扩展无法在不引入 native 依赖的前提下提供等价保证；(b) **持久化 allow 规则**——Codex 与 CC 都有，但 CC 自己的 tracker 上"don't ask again 的持久化写回"是被报告最多的缺陷区（5 个 issue），需要单独的存储 + 作用域 + 撤销设计，属独立里程碑；(c) **计划审阅面板**——CC/DSH 的专用 UI（计划渲染成文档、内联评论、选项各自切不同模式），当前复用通用审批卡片。



