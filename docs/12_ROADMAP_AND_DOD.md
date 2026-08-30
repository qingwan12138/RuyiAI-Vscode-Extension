# 12 — Roadmap & Definition of Done

## v0.1 Foundation / Chat Vertical Slice
- activation + sidebar/webview typed protocol
- local Session persistence + migrations
- provider settings wizard + SecretStorage/env
- OpenAI-compatible adapter（覆盖 llama.cpp server）+ 至少一个云 provider
- streaming chat + model/session persistence
DoD：重启 VS Code 会话可恢复；secret 不落普通存储；fake provider 测试通过。

## v0.2 Coding Agent MVP
- Read/List/Search/Selection/@file/@folder scope/@symbol
- Agent loop + tool schema + PermissionEngine Plan/Manual
- ProcessRunner + Diagnostics
DoD：fixture repo 可完成“定位 → 修改 proposal → 用户批准 → 验证”的端到端任务。

## v0.3 Reliable Editing
- patch/edit/create/delete + stale write guard
- diff/accept/reject/undo
- Accept Edits/Auto/Full Access
- validation planner + loop guard + Stop/Continue
DoD：失败测试可自动迭代修复；Stop 不损坏 session；无验证不声称成功。

## v0.4 Git / Parallel Sessions
- git status/diff
- worktree manager + isolated execution workspace
- multi-session process separation
DoD：两个写 session 并行不直接修改同一 working tree；dirty worktree 删除保护。

## v0.5 Ruyi Typed Tools
- RuyiPort/porcelain parser/package/profile/venv/update/extract 等
- Ruyi operation UI + permission risk
- optional upstream refresh bridge
DoD：不用解析 human CLI 文本完成核心 Ruyi 操作；上游 bridge 缺失不影响核心。

## v0.6 Ruyi Intelligent Workflow
- Board/Profile/Toolchain/Sysroot/Venv/Build workflow
- Ruyi-aware validation / recovery
DoD：至少一个真实 Ruyi/RISC-V fixture 或测试环境完成端到端 workflow。

## v0.7 Context & Mature Agent
- compaction、repo map/index、plan/todo、history management
- provider capability degradation、cost/context controls
DoD：长会话不因简单 context overflow 崩溃；模型能力缺失有明确降级。

## v0.8 Upstream Integration
- 合并进指定 ruyisdk-vscode-extension
- one VSIX
- UI consistency/i18n/Remote SSH regression
DoD：原 RuyiSDK regression + Yisi regression 全过；集成 diff 集中在 seam。

## v0.9 RC
性能、安全、许可证、依赖、迁移、日志 redaction、文档、兼容矩阵。

## v1.0 Delivery
冻结 API/schema；交付 VSIX、安装/使用/维护/升级说明、第三方 NOTICE、测试报告。
