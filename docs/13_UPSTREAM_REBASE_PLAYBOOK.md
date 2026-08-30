# 13 — Upstream Rebase / Re-integration Playbook

目标：上游 RuyiSDK 插件更新时，不重新“手工移植 Yisi”。

1. 锁定上游旧/新 tag/commit，记录 compatibility matrix。
2. 在纯上游分支运行其测试/打包，确认 baseline。
3. 更新 host package，优先解决 activation/package.json contribution 冲突。
4. 不把冲突解决成 Yisi import 上游内部 service；必要适配写到 HostBridge。
5. 跑 Yisi unit/integration。
6. 跑 Ruyi packages/venv/setup/build/news/repo 等原功能 smoke test。
7. 跑 one-VSIX activation + Webview + Remote SSH smoke。
8. 记录本次上游变化与 Yisi adapter 改动。

建议维护 `UPSTREAM_COMPATIBILITY.md`：upstream version → Yisi version → status → known issues。
