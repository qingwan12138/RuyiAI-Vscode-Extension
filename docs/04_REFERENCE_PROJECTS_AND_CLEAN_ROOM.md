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
