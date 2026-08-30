# Blueprint Changelog

## v0.10 — CC-Style Topbar
- 去掉侧栏最顶部额外的 `Yisi AI` View 标题文字。
- `New Chat / Session Title` 导航栏直接作为侧栏可见内容顶部。
- 默认空 Session 标题由 `Untitled` 改为 `New Chat`。
- 保留中央 `Yisi AI + Ruyi Mark` 品牌区域。
- 保留主题自适应透明 Ruyi Mark。
- 更新 UI 规范与 AGENTS.md，防止后续重新引入重复标题。

## v0.9 — Theme-Adaptive Ruyi Mark
- 欢迎页不再直接显示白底 Ruyi PNG。
- 从原始 Logo 生成透明主线条/黄色强调两层 mask。
- 主线条颜色绑定 `--vscode-foreground`，随 Dark/Light 主题自动改变。
- High Contrast 模式优先使用主题前景色。
- 删除 Logo 白色卡片视觉。
- 保留透明原色 Logo 作为非主题敏感场景备用资源。
- 新增 `21_THEME_ADAPTIVE_RUYI_MARK.md`。

## v0.8 — Polished UI Runnable
- 将欢迎页真正接入 `YisiChatViewProvider`，不再只是静态 template。
- 移除“大 Logo + 开发说明 + 两个按钮”的工程占位 UI。
- Ruyi Logo 调整为紧凑品牌锚点。
- 增加 Session Header / New Session。
- 增加四个固定 Quick Actions。
- 增加底部 Composer、Add Context、Model、Permission、Send。
- 支持 Enter 发送、Shift+Enter 换行与自动输入框高度。
- 使用 VS Code theme variables，适配窄侧边栏。
- 增加 Webview → Extension Host → Webview 的消息回环验证。
- 真实模型/Agent/权限/上下文仍按后续 milestone 实现。

## v0.7 — Ruyi Brand UI
- 将用户提供的 Ruyi Logo 纳入工程资源：`media/ruyi-logo.png`。
- Yisi AI 欢迎页/空 Session 中央品牌位确定使用 Ruyi Logo。
- 新增 UI Branding & Welcome Screen Contract。
- 新增 ADR-0003。
- 明确 Claude Code 仅用于布局/交互参考，禁止品牌资产和像素级复制。
- 新增 welcome Webview HTML/CSS 参考模板。
- 使用 VS Code theme variables，保留 dark/light theme 适配方向。
- package.json 增加 extension icon。
- 保留 v0.6 的 TS/JS Primary、Linux Local-First、闭源与开源参考边界。

## v0.6 — TS/JS Primary
- 固化 Yisi AI 自研主体 TypeScript / JavaScript only（优先 TypeScript）。
- 明确该规则不禁止调用 Ruyi/Git/compiler/llama.cpp 等外部工具。
- 明确测试 fixture 可以使用其他语言。
- Native addon / 第二运行时改为受控例外，而非字面意义绝对禁止。
- 新增 Implementation Language & Dependency Contract。
- 新增 ADR-0002。
- AGENTS.md 增加依赖/语言防跑偏规则。
- 保持 v0.5 Runnable Baseline 和 Linux Local-First 决策。

## v0.4 — Linux Local-First
- 将 Linux 本机 VS Code 明确为唯一 P0 交付场景。
- Remote-SSH 从 P0 移到 Future/P1。
- 删除当前 package.json 中提前设置的 workspace-only `extensionKind`。
- 重写 Linux Platform Contract。
- 重写 Remote/Terminal 文档，使 Remote 仅作为未来兼容性设计。
- 新增 ADR-0001 固化范围决策。
- 保留 ExecutionWorkspace / PlatformAdapter 等未来扩展抽象。
- 当前 CI/DoD 不再要求 Remote-SSH。

## v0.5 — Runnable Linux Local Baseline
- 修复 `activationEvents` 冗余 Schema 提示：删除 `onView:yisiAI.chat` 显式声明。
- 给 `yisiAI.chat` view 补充 icon。
- 保留 Activity Bar container icon。
- 新增 `.vscode/launch.json` / `tasks.json`，支持 F5 Extension Development Host。
- 新增 `.gitignore` / `.vscodeignore`。
- Webview 增加 CSP 和真正的 `onDidReceiveMessage` 桥。
- 新增 `npm run check` 与 clean script。
- 新增 Runnable Baseline 契约文档。
- Linux Local-First 和 Remote-SSH 延后决策保持不变。