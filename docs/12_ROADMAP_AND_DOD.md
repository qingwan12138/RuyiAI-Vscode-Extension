# 12 — Roadmap & Definition of Done

## v0.1 Foundation / Chat Vertical Slice
- activation + sidebar/webview typed protocol
- local Session persistence + migrations
- provider settings wizard + SecretStorage/env
- OpenAI-compatible adapter（覆盖 llama.cpp server）+ 至少一个云 provider
- streaming chat + model/session persistence
DoD：重启 VS Code 会话可恢复；secret 不落普通存储；fake provider 测试通过。

当前实现状态（2026-08-30）：代码基线已覆盖以上条目。自动化测试覆盖 Session 恢复、SecretStorage 与普通状态隔离、Provider 配置、模型发现、SSE 分片、失败/取消、最终回复持久化和 Webview 运行状态；真实云账号联网与人工 Extension Development Host 视觉验收仍作为环境相关验收记录，不扩张为已完成 Agent 能力。

## v0.2 Coding Agent MVP
- Read/List/Search/Selection/@file/@folder scope/@symbol
- Agent loop + tool schema + PermissionEngine Plan/Manual
- ProcessRunner + Diagnostics
DoD：fixture repo 可完成“定位 → 修改 proposal → 用户批准 → 验证”的端到端任务。

当前实现状态（2026-08-31，部分）：已实现受限 Read/List/Search/唯一文本替换、canonical workspace/symlink 边界、常见凭据文件的隐式搜索/Agent 读写排除、显式文件上下文附加、统一风险类型的 Permission Engine，以及结构化 ProcessRunner、VS Code Diagnostics 快照与顺序 ValidationEngine。进程执行使用 `shell:false` 的精确 argv，stdout/stderr 独立限量，支持超时/取消；Linux 使用受控进程组 SIGTERM → grace → SIGKILL。新建 Provider 可显式启用 OpenAI-compatible 结构化 Agent tool loop；单一本地工作区的 Composer 已接通工具 schema、逐次权限判定、结果回传、取消与循环保护，旧配置迁移为关闭。编辑要求 read 返回的 SHA-256、唯一匹配与原子同目录替换；Plan 拒绝，Manual 使用 Extension Host 原生确认，Session 权限选择器已接通。成功编辑会返回有界的即时 workspace diagnostics 快照；不可用时明确标记，且不把快照宣称为语言服务刷新完成或验证通过。创建/删除/重命名、完整 diff/undo 与完成级自动验证闭环仍未实现，因此 v0.2 DoD 尚未完成。

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
