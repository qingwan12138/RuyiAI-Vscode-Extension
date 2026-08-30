# 17 — Runnable Baseline Contract

## 目标
本目录既是闭源开发蓝图，也是可以直接进入 VS Code Extension Development Host 的最小工程起点。

## 当前必须满足

```text
npm install
npm run check
npm run compile
F5
```

F5 后应看到：
- Activity Bar 中的 Yisi AI 容器。
- Yisi AI Webview。
- New Chat 按钮可创建本地 Session 记录。
- Model Settings 可打开设置。
- package.json 不再显式声明由 contributions 自动推导的 `onView` activation event。
- view/container 都有 icon 声明。

## 当前不是“功能完成”
Runnable Baseline 只证明 Extension manifest、TypeScript 编译、activation、Webview 消息桥和基本调试入口成立。

它不代表以下能力已完成：
- 真正 LLM 请求。
- Agent Loop。
- Tool execution。
- Diff/Undo。
- Ruyi workflow。
- 完整 Session UI。
- Permission confirmation UI。

这些必须继续按 Roadmap / DoD 实现，禁止把 starter UI 当成产品 UI。

## Manifest 规则
- 不重复声明可以由 `contributes` 自动生成的 activation event。
- command/view/container ID 统一使用 `yisiAI.*` / `yisiAI` namespace。
- Secret 不进入 configuration。
- package.json 新增贡献点后必须在当前 VS Code Schema 下检查零 error。

## Webview 规则
- 必须有 CSP。
- Webview 只能通过 typed message bridge 请求 Extension Host 能力。
- Webview 禁止直接访问 Node filesystem/process。
- 后续前端框架即使升级为 React，也不得破坏该边界。
