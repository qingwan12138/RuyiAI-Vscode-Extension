# AGENTS.md — 给所有 Coding Agent / 开发者的强制规则

## 0. 最高优先级

你正在开发一个 **闭源横向项目**。不要把任何开源 Coding Agent 仓库直接 fork、复制、搬运、改名后集成。参考项目只用于学习产品行为、公开架构思想、交互模式和问题拆分。新增第三方代码/依赖前必须检查许可证并登记。

## 1. 开工前必须读取

至少读取：
- `docs/00_START_HERE.md`
- `docs/02_ARCHITECTURE_CONTRACT.md`
- `docs/04_REFERENCE_PROJECTS_AND_CLEAN_ROOM.md`
- `docs/12_ROADMAP_AND_DOD.md`

涉及权限/执行时再读 06/07/08；涉及 Ruyi 时读 09；涉及 UI 时读 10。

## 2. 禁止跑偏

禁止：
- 把 Yisi AI 写成只有聊天框的 LLM wrapper。
- 把某一个 Provider SDK 直接散落到 Agent Core。
- 让 LLM 自己决定是否绕过 Permission Engine。
- 直接 import `ruyisdk-vscode-extension` 的内部 service/provider/class 作为核心依赖。
- 把 API Key 写入 settings.json、日志、会话 JSON 或 prompt history。
- 让 Webview 直接读文件、spawn shell、调用 Ruyi CLI；这些必须通过 Extension Host 服务层。
- 把 VS Code Terminal 当作唯一命令执行后端。
- 每次 edit 后机械执行全套测试；采用阶段性验证 + 完成前至少一次有效验证。
- 宣称“已修复/已完成”但没有验证证据；无验证手段必须明确说明。
- 默认读取 `.gitignore` 内容；用户显式引用除外。
- 自动恢复 VS Code 关闭前的长期进程；只能记录并让用户 Resume。

## 3. 依赖方向

`ui -> application -> domain`；`infrastructure -> domain ports`；domain 不依赖 vscode、具体 LLM SDK、具体数据库、Ruyi 上游 UI。

## 4. 每个 PR/变更必须回答

1. 属于哪个 roadmap milestone？
2. 改动了哪个模块的职责？
3. 是否新增跨层依赖？为什么？
4. 是否触及权限、文件写入、shell、secret、网络？若是，测试在哪里？
5. 是否参考了外部项目？只写“参考的行为/思想”，不得复制实现。
6. 有哪些验证证据？
7. 是否改变已确认产品决定？若改变，必须先得到用户确认并更新 ADR/文档。

## 5. 实现策略

优先小步 vertical slice：一个真实用户动作从 UI → runtime → tool/provider → result → persistence 跑通，再扩展功能。不要先生成几十个空 interface/manager/service。


## Linux Local-First mandatory rules
- 本项目当前正式目标环境是 Linux 本机 VS Code + Linux 本地 workspace。
- Remote-SSH 不属于当前 v1.0 必须交付能力；除非后续需求正式开启，不要实现 SSH/Remote 专属逻辑。
- 但必须保留 `ExecutionWorkspace`、`PlatformAdapter`、`ProcessRunner` 等抽象，禁止把 Agent Core 写死成未来无法扩展。
- 不假定 `.bashrc` 被加载。
- 不假定 `/bin/sh` 是 bash。
- 不假定 root。
- 机器可判定命令优先 `spawn(executable,args,{shell:false})`。
- Stop 必须考虑 Linux process tree/process group，不能只 kill shell 父进程。
- 文件编辑必须尊重 case-sensitive、symlink、Unix mode、permission、EOL。
- `sudo`、系统目录、系统包管理属于高风险操作；不得收集或传递 sudo 密码给模型。
- 第一阶段避免 native dependencies；新增 native addon 必须先做 ABI/架构/VSIX/许可证审核。
- Linux/Process/Ruyi/Git/Terminal 相关实现前必须阅读 `docs/16_LINUX_FIRST_PLATFORM_CONTRACT.md`。


## TypeScript / JavaScript primary implementation rule
- Yisi AI 自研产品代码只使用 TypeScript / JavaScript 作为正常实现语言，优先 TypeScript。
- 允许调用由其他语言实现的外部工具，例如 ruyi、git、gcc、clang、cmake、llama.cpp；必须通过明确的 Port/Adapter/Process/HTTP 边界。
- 测试 fixture 可以包含 C/C++/Python/Rust 等目标项目源码；它们不是 Yisi 实现代码。
- 默认禁止为了方便新增 Python backend、Rust daemon、Go service、C/C++ helper 或第二套运行时。
- Native Node addon / 非 TS-JS 自研组件属于“受控例外”，必须先完成架构、ABI、Linux 打包、CPU 架构、许可证、闭源交付和维护成本评估。
- 参考 Aider/Cline/Codex 等项目时学习思想和架构；不得因为参考项目使用某种语言就把其运行时直接搬入 Yisi。
- 新增依赖前优先级：VS Code API > Node 标准库 > 小型纯 TS/JS 包 > 大型框架 > Native addon。
- 修改依赖或提出新运行时时，必须先阅读 `docs/17_IMPLEMENTATION_LANGUAGE_AND_DEPENDENCY_CONTRACT.md`。


## UI branding rule
- Yisi AI 欢迎页/空 Session 中央品牌视觉使用 `media/ruyi-logo.png`。
- Claude Code/Codex 等只作为交互与信息架构参考，不得像素级复刻，不得复制其品牌资产、吉祥物、文案或专有视觉元素。
- Webview 应使用 VS Code theme variables，保持独立的 Ruyi/Yisi 品牌风格。
- UI 修改前阅读 `docs/19_UI_BRANDING_AND_WELCOME_SCREEN.md`。


## Runnable UI baseline rule (v0.8+)
- `src/yisi/ui/chatViewProvider.ts` 中的欢迎页是当前可运行 UI 基线，禁止退回大 Logo + 工程说明 + 两个按钮的占位页。
- Ruyi Logo 是小型品牌锚点，不应作为占满侧边栏的大图。
- 空 Session 保持克制：顶部 Session、中央品牌/快捷任务、底部 Composer。
- 未实现能力必须显示为真实的占位入口或延后，不得在 Webview 里伪造 Agent 成功结果。


## Theme-adaptive Ruyi mark rule
- 欢迎页禁止直接插入白底 `ruyi-logo.png`。
- 当前正式欢迎页使用 `ruyi-primary-mask.png` + `ruyi-accent-mask.png` 两层 CSS mask。
- 主体颜色使用 `var(--vscode-foreground)` 跟随 VS Code 主题；黄色作为 Ruyi 品牌强调色。
- High Contrast 模式优先可访问性，两层均可退化为主题 foreground。
- 不得重新增加白色 Logo 卡片/白底方框。


## CC-style sidebar topbar rule (v0.10+)
- 侧栏顶部禁止出现额外的 `Yisi AI` View 标题行。
- Webview 可见区域应直接从 Session 导航栏开始：`New Chat / Session Title + History + New Session`。
- 中央欢迎区可以保留 `Yisi AI` 品牌名和 Ruyi Mark。
- 后续 UI 改动不得重新引入重复的顶部产品标题。


## Main-screen (home) rule

- **「回到主界面」= 新开会话**：主界面必须永远对应**空会话**，因此左上角标题显示 `New Chat`，不会残留上一个会话的名字。
- 因此 ⌂ 的行为是：当前会话**已有内容**时新开会话并回到主界面（旧对话保留在 Session history，不丢失）；当前会话**已经是空的**时复用，不重复创建空会话。
- **禁止**在非空会话上直接显示主界面并沿用它的标题——用户已明确报告过这种困惑（界面看起来是全新开始，标题却是上一个会话的名字，而在主界面输入还会继续那个旧会话）。
- 未决：**启动时**仍按旧规则显示主界面（AGENTS.md 要求"不得直接落进上一个对话"），此时主界面仍可能挂着有历史会话的标题。若要一并改，需先修改该启动规则并确认空会话的堆积代价。


## Agent system prompt rule

- Agent 运行**必须**带上两段 system 内容，位置不能混：**头部**放稳定的"角色 + 工具使用纪律"（`application/agent/agentSystemPrompt.ts`），**历史之后、当前用户轮之前**放随模式变化的权限简报（`application/agent/permissionModePrompt.ts`）。详见 `docs/06`。
- **禁止**让 agent 路径处于"无 system prompt"状态。历史事故：模型只拿到对话 + ~24 个工具定义 + `tool_choice: 'auto'`，被问"请你介绍一下RISC-V吧"这种**通识问题**时，因工具描述里含 "RISC-V" 字样而先去调 `ruyi_check` 和 `list_directory`——不是模型想查环境，而是没有任何指令告诉它通识问题不需要工具。
- 角色/纪律里**不得**写模式限制（会让头部随模式变化、破坏缓存前缀）；模式简报里**不得**重复角色/纪律。守卫：`test/permission-mode-prompt.test.js`。
- 该纪律**不构成**对 Permission Engine 的任何削弱：工具执行始终逐次过引擎，见 §2 与 `docs/07`。
