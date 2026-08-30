# Yisi AI 产品需求基线

## 产品定位
Yisi AI 是面向 RuyiSDK / RISC-V 开发场景的闭源 VS Code Coding Agent。最终与 `ruyisdk-vscode-extension` 合并为一个 VSIX，但内部保持独立模块边界。

## 已确认需求

### 模型
- 多 Provider：OpenAI / Anthropic / DeepSeek / Gemini / OpenRouter / OpenAI-compatible。
- 本地模型第一阶段只连接已启动的 llama.cpp server，不负责下载或启停模型。
- 全局默认 + 项目覆盖 + Session 绑定。
- 已有 Session 永久记住自己的 Provider / Model。
- API Key / Token 使用 VS Code SecretStorage；可扩展环境变量凭据来源。
- 齿轮进入 Provider 配置向导；对话输入区快速切模型。

### Session
- 一个项目允许多个持久化 Session。
- 一个 Session 可连续处理任意数量任务，不做“一会话一任务”限制。
- Session 独立保存模型和权限。
- 标题 AI 自动生成，允许用户改名；用户改名后不再自动覆盖。
- 历史默认永久保留，只有用户手动删除。
- 第一版不做导入/导出和云同步。
- Stop 中断当前 AgentRun，不删除 Session；支持 Continue 或直接继续发消息。

### 权限
模式：Plan / Manual / Accept Edits / Auto / Full Access。
- 新项目首次默认 Plan。
- 重新 clone / 路径迁移视为新项目，重新 Plan。
- 权限按 Session 独立保存。
- Permission Engine 与 LLM Provider 解耦。

### 并行与 Worktree
- 普通单会话直接使用当前工作区。
- 同一项目存在并行写操作时，自动建议/创建 Git worktree 隔离。
- UI 明确显示当前运行于主工作区还是 isolated worktree。
- 删除 Session 时由用户选择是否删除关联 worktree；存在未提交修改时额外警告。

### 上下文
- 支持选中代码上下文。
- 支持 `@file` / `@folder` / `@symbol`。
- `@folder` 仅作为搜索范围，不整体塞入模型上下文。
- 默认尊重 `.gitignore`；用户显式引用时可读取 ignored 文件。
- Git untracked 文件默认可见和可搜索。
- 预留：@diagnostics / @terminal / @git-diff / @ruyi-env。

### 代码修改与执行
- Plan：只读。
- Manual：先 Diff / 确认再写。
- Accept Edits：自动写入 + Diff + Undo。
- Auto：常规操作自动执行，高风险拦截。
- Full Access：高自主执行，但仍保留 Diff / 操作记录 / Undo。
- Terminal：对话中展示摘要和关键输出，同时支持 Open in Terminal。
- 每个 Session 保持独立 Terminal 执行上下文。
- 长进程可启动/监控/Stop；关闭 VS Code 后不自动重启，重开后显示 Stopped + Resume。

### 验证闭环
- VS Code Problems / Diagnostics 是正式上下文信号源。
- 不要求每次 Edit 都扫描 Diagnostics；采用阶段性验证。
- Agent 宣告完成前至少执行一次可用验证。
- 验证可组合：Diagnostics / Build / Tests / Lint / Typecheck / Ruyi target checks。
- 无法验证时必须明确说明“未能自动验证”。

### Agent Loop
- 不采用用户可感知的固定 retry 次数。
- 持续 Reason → Tool → Result → Reason 循环。
- 停止条件：成功、明确无法继续、需要用户输入、权限阻塞、用户 Stop、Loop Guard 判定无进展。
- Loop Guard：重复错误/重复操作/无进展/context-token 预算/tool-call 安全阈值。
