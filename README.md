# Yisi AI — Closed-Source Development Blueprint v0.2

> **用途：这是开发“约束源（source of truth）”，不是普通 README。** 任何人或 Coding Agent 在修改 Yisi AI 前，都应先阅读 `docs/00_START_HERE.md`、`docs/02_ARCHITECTURE_CONTRACT.md`、`docs/04_REFERENCE_PROJECTS_AND_CLEAN_ROOM.md` 和 `AGENTS.md`。

Yisi AI 是面向 RuyiSDK / RISC-V 开发场景的 VS Code Coding Agent。最终交付形态为 **一个 VSIX**：保留上游 `ruyisdk-vscode-extension` 原有能力，并嵌入闭源 Yisi AI 模块。Yisi AI 的核心必须保持独立，避免随上游 UI/内部服务重构而大面积修改。






## v0.10 顶部布局

侧栏不再显示额外的 `Yisi AI` View 标题。打开 Yisi AI 后，最顶部直接是 `New Chat / Session Title` 导航栏；中央仍保留 Yisi AI + Ruyi 品牌。

## v0.8 可运行 UI

当前 Webview 已经不是工程占位页。F5 后打开 Yisi AI，会直接看到 Ruyi 品牌欢迎页、快捷任务和底部 Composer。

当前 Session 元数据、用户消息和已完成的 Provider 回复会持久化到 VS Code 全局扩展存储。历史面板支持切换、重命名和确认删除，重启 Webview/扩展后会恢复当前 Session。Composer 已接通 OpenAI 与 OpenAI-compatible Chat Completions 流式接口；显式启用结构化 tool calling 后可运行受限 Agent 工具，界面不会伪造 Agent 成功结果。

## UI 品牌方向

Yisi AI 的欢迎页/空白 Session 中央视觉统一使用 **Ruyi Logo**（`media/ruyi-logo.png`）。

可以参考 Claude Code 的空白页信息架构、底部输入框和控制区布局，但只能参考交互思想，不能复制其吉祥物、品牌资产或像素级 UI。

详细规则见 `docs/19_UI_BRANDING_AND_WELCOME_SCREEN.md`。

## 实现语言约束

Yisi AI 自研主体统一采用 **TypeScript / JavaScript，优先 TypeScript**。这是为了与 RuyiSDK VS Code 扩展保持一致，并降低后续合并、维护和闭源交付复杂度。

这不禁止 Yisi 调用 `ruyi`、Git、GCC/Clang、CMake、llama.cpp 等外部工具，也不禁止测试项目包含 C/C++ 等源码。Native addon 或第二套自研运行时默认不引入，确有必要时必须先进行架构审批。

详细规则见 `docs/17_IMPLEMENTATION_LANGUAGE_AND_DEPENDENCY_CONTRACT.md`。

## 平台定位：Linux Local-First

本项目当前正式应用场景是 **Linux 本机 VS Code**。

P0 只保证：

```text
Linux PC / Workstation
        ↓
      VS Code
        ↓
      Yisi AI
        ↓
项目 / RuyiSDK / Git / Toolchain / Build / Test
```

Remote-SSH 不作为当前 v1.0 必须交付能力，后续需要时再单独增加。当前只保留 `ExecutionWorkspace`、`ProcessRunner`、`PlatformAdapter` 等扩展抽象，避免未来返工。

详细规则见 `docs/16_LINUX_FIRST_PLATFORM_CONTRACT.md`。


## 这个包解决什么问题

- 把已经确认的产品决定写成不可随意改变的架构契约。
- 把“参考 Claude Code / Codex / Cline / Aider 等”具体化为 **参考什么、不参考什么、禁止复制什么**。
- 给 vibe coding 设置边界：模块职责、依赖方向、数据模型、权限、会话、模型、工具、终端、验证、worktree、Remote SSH、RuyiSDK 集成均有规则。
- 给每个版本设置 Definition of Done，避免“UI 看起来能聊”就误判为 Agent 已完成。
- 为闭源交付保留第三方依赖与许可证审计入口。

## 必读顺序

1. `docs/00_START_HERE.md`
2. `docs/01_PRODUCT_REQUIREMENTS.md`
3. `docs/02_ARCHITECTURE_CONTRACT.md`
4. `docs/03_DOMAIN_MODEL_AND_STATE.md`
5. `docs/04_REFERENCE_PROJECTS_AND_CLEAN_ROOM.md`
6. `docs/05_MODULE_AND_TECH_CHOICES.md`
7. `docs/06_AGENT_LOOP_TOOLS_VALIDATION.md`
8. `docs/07_SECURITY_PERMISSIONS_PRIVACY.md`
9. `docs/08_VSCODE_REMOTE_AND_TERMINAL.md`
10. `docs/09_RUYISDK_INTEGRATION.md`
11. `docs/10_UI_UX_SPEC.md`
12. `docs/11_TESTING_EVALUATION_CI.md`
13. `docs/12_ROADMAP_AND_DOD.md`
14. `docs/13_UPSTREAM_REBASE_PLAYBOOK.md`
15. `docs/14_DEPENDENCY_LICENSE_POLICY.md`
16. `AGENTS.md`

## 一句话架构原则

**物理上合并为一个 RuyiSDK VS Code 插件；逻辑上 Yisi AI 是独立 Agent 产品；RuyiCLI `--porcelain` 是核心稳定边界；VS Code 官方 API 是宿主边界；上游扩展内部对象只能软集成。**

## 当前阶段

本包已完成 v0.1 Foundation / Chat Vertical Slice 的代码基线，并进入 v0.2 Coding Agent MVP，但不声称已完成 Coding Agent。现已具备 Session/模型/权限持久化、Provider 设置、安全凭据、SSE 流式聊天、Stop、受工作区边界保护的 Read/List/Search、唯一文本替换和排他式文本文件创建工具、文件删除/重命名/目录创建工具（`delete_file`/`rename_file`/`create_directory`，均有边界与敏感路径保护）、对 agent 自建文件的整文件重写工具（`rewrite_text_file`，需 `read_file` 的 sha256 做 stale guard）、受权限门管控的结构化命令执行工具（`run_command`：build/test/lint，Plan 拒绝、其余模式确认、Full Access 放行，特权与系统/包管理器命令硬拒）、只读的项目探测工具（`inspect_project`：识别语言/构建系统/测试框架并给出建议命令，证据带文件与置信度）、类型化 Permission Engine、显式 `@file` 内容附加，以及结构化 ProcessRunner/ValidationEngine。ProcessRunner 使用精确 argv、独立输出限量、超时/取消和 Linux 进程组终止；VS Code Diagnostics 已有工作区限定的快照适配器和验证证据。编辑器右键/命令面板提供三个选区任务（解释选中代码、生成注释、生成单元测试），复用会话与 Agent 链路并随会话持久化；单元测试选区任务会先探测项目构建/测试框架并附入提示。新建 Provider 时可显式启用 OpenAI-compatible 结构化 Agent tools；在单一本地工作区内，当前 Composer 可读取并搜索文件，也可用读取结果的 SHA-256 做 stale guard 后替换一个唯一文本片段、整文件重写 agent 自建文件、排他新建文件、删除/重命名文件、创建目录，并可请求运行构建/测试命令获取结构化输出。写入结果会附带有界的即时 VS Code diagnostics 快照，但该快照不等于语言服务已完成刷新或构建测试通过。Plan 拒绝写入与命令执行，Manual 使用 VS Code 原生确认，Accept Edits/Auto 按权限策略允许这些有界动作。旧 Provider 安全迁移为纯聊天，零/多工作区或非本地工作区不会启用工具。完成级自动验证闭环（ValidationPlanner 自动跑 build/test 并迭代修复）与修改 diff/Undo 仍待继续实现。

## 配置并运行聊天

1. 在 Yisi AI Composer 底部点击 `Model`。
2. 首次使用选择 `Add Provider`，可配置官方 OpenAI 或自定义 OpenAI-compatible 地址。
3. API Key 可存入 VS Code SecretStorage，或只填写环境变量名；可信的本地兼容端点可选择无凭据。
4. 明确选择 Provider 是否支持 OpenAI-compatible tool calling；不确定时选择 `Text chat only`。
5. 选择模型和 Session 权限模式后发送消息；生成期间发送按钮变为 Stop。启用 tools 且只有一个本地工作区时，模型可请求 Read/List/Search；非 Plan 模式还可按权限策略请求一次唯一文本替换。
6. 点击 Composer 左侧 `＋` 可显式附加当前工作区内的 UTF-8 文本文件；Session 只保存文件引用，原始文件内容仅用于当次请求。

Provider 普通元数据与密钥分开保存。自定义本地端点允许 HTTP；官方 OpenAI 配置强制 HTTPS。当前自动化测试使用本地 fake HTTP/SSE 服务，不代表已使用用户的真实云账号完成联网验收。

## v0.5 Runnable Baseline 使用方式

```bash
npm install
npm run check
npm run compile
```

然后在 VS Code 中按 `F5`，启动 `Run Yisi AI Extension`。当前 starter 验证 Extension manifest、Webview、Session、Provider 配置、流式聊天和有界 Agent 工具链路。详细见 `docs/17_RUNNABLE_BASELINE.md`。
