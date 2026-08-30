# Yisi AI — Closed-Source Development Blueprint v0.2

> **用途：这是开发“约束源（source of truth）”，不是普通 README。** 任何人或 Coding Agent 在修改 Yisi AI 前，都应先阅读 `docs/00_START_HERE.md`、`docs/02_ARCHITECTURE_CONTRACT.md`、`docs/04_REFERENCE_PROJECTS_AND_CLEAN_ROOM.md` 和 `AGENTS.md`。

Yisi AI 是面向 RuyiSDK / RISC-V 开发场景的 VS Code Coding Agent。最终交付形态为 **一个 VSIX**：保留上游 `ruyisdk-vscode-extension` 原有能力，并嵌入闭源 Yisi AI 模块。Yisi AI 的核心必须保持独立，避免随上游 UI/内部服务重构而大面积修改。






## v0.10 顶部布局

侧栏不再显示额外的 `Yisi AI` View 标题。打开 Yisi AI 后，最顶部直接是 `New Chat / Session Title` 导航栏；中央仍保留 Yisi AI + Ruyi 品牌。

## v0.8 可运行 UI

当前 Webview 已经不是工程占位页。F5 后打开 Yisi AI，会直接看到 Ruyi 品牌欢迎页、快捷任务和底部 Composer。

当前 Session 元数据、用户消息和明确标注的 baseline assistant notice 会持久化到 VS Code 全局扩展存储。历史面板支持切换、重命名和确认删除，重启 Webview/扩展后会恢复当前 Session。真实 LLM 与 Agent Runtime 仍未连接，界面不会伪造模型成功结果。

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

本包仍处于 v0.1 Foundation 开发阶段，不声称已完成 Agent。Session 持久化与历史管理切片已经落地；Provider 设置、SecretStorage、真实流式聊天和 fake-provider 端到端测试仍需按 `docs/12_ROADMAP_AND_DOD.md` 继续实现与验收。

## v0.5 Runnable Baseline 使用方式

```bash
npm install
npm run check
npm run compile
```

然后在 VS Code 中按 `F5`，启动 `Run Yisi AI Extension`。当前 starter 只验证 Extension manifest、Webview、命令桥和基础 Session 创建链路，不代表 Agent 能力已经完成。详细见 `docs/17_RUNNABLE_BASELINE.md`。
