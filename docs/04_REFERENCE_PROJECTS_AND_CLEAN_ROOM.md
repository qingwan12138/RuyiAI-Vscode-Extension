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

