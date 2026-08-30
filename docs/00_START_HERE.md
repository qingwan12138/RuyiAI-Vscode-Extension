# 00 — Start Here：项目北极星与防跑偏规则

## 产品北极星

Yisi AI 不是“给 RuyiSDK 加一个聊天窗口”，而是一个能在 VS Code 内持续完成开发任务的 Coding Agent，并把 RuyiSDK 的包管理、工具链、Profile、虚拟环境、构建/设备流程作为一等工具能力。

典型目标：用户说“把这个项目在这块 RISC-V 板子上跑起来”，Agent 能逐步检查项目 → Ruyi 环境 → Profile/Toolchain/Sysroot/Venv → 构建 → 读取错误 → 修改 → 验证，并在权限边界内完成闭环。

## 已确认、不得擅自改变的产品决定

- 最终闭源交付；一个 VSIX 中包含原 RuyiSDK 功能 + Yisi AI。
- Yisi 内部独立模块化，避免硬依赖上游内部实现。
- 多 Provider；本地模型第一阶段只连接已启动的 llama.cpp/OpenAI-compatible server，不负责模型管理。
- 模型配置：全局默认 + 项目覆盖；具体 Session 独立持久化模型选择。
- API Key/Token 默认 VS Code SecretStorage；高级用户可用环境变量；普通参数可普通持久化。
- Provider 设置通过齿轮/向导；聊天输入区快速切模型。
- 权限 Session 独立持久化；新路径/重新 clone 视为新项目；新项目首次默认 Plan。
- 会话可持续多轮、多任务；历史本地永久保存，用户手动删除；第一版不导入导出。
- 删除 Session 时让用户选择是否删除关联 worktree/临时文件；有未提交修改必须警告。
- 会话标题 AI 自动生成，可手动重命名。
- 新会话第一阶段：空白聊天 + 固定快捷任务；以后再做智能推荐和自定义。
- 支持 Selection 与 `@file/@folder/@symbol`；folder 是搜索范围而非一次性注入全部内容。
- 默认尊重 `.gitignore`；untracked 可见；显式引用可访问被 ignore 的文件。
- 修改策略由权限模式决定；所有实际修改必须可追踪 Diff。
- 命令结果对话内摘要 + 可展开 + Open in Terminal；长进程可 Stop，关闭 VS Code 后不自动恢复。
- Diagnostics 是正式上下文来源，但验证不等于每次 edit 后扫描 Problems。
- 完成前至少一次可用验证；失败进入持续 Agent Loop，不设置用户可感知的固定 retry 次数；内部 Loop Guard。
- Stop 中断当前 AgentRun，不删除 Session；Continue 是新 Turn 基于持久化状态继续，而不是恢复半截 LLM stream。
- 同项目并行写入时使用/建议独立 Git worktree；普通会话默认当前 workspace。

## 冲突解决顺序

1. 用户最新明确决定
2. 本文档已确认决定
3. 架构契约 / ADR
4. Claude Code / Codex 当前成熟行为（只作行为参考）
5. Cline/Aider/Roo/Continue 等公开项目（只作工程思想参考）
6. 开发者个人偏好

## 什么情况下必须再问用户

只问会改变产品方向/交付范围/安全模型/上游兼容策略的决定。普通实现细节优先参考 Claude Code/Codex 和本蓝图自行决策。


## Linux Local-First 必读

当前正式交付场景为 Linux 本机 VS Code。Remote-SSH 延后，不作为当前版本 DoD。

开始实现 ProcessRunner、Ruyi、Git、Worktree、Provider 网络或 Terminal 功能前，必须阅读 `16_LINUX_FIRST_PLATFORM_CONTRACT.md`。
