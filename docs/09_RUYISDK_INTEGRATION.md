# 09 — RuyiSDK Integration Contract

## 核心边界
Yisi 不依赖上游 VS Code 扩展内部 service/provider/class。核心通过 `RuyiPort` 调 Ruyi CLI；机器可读操作优先 `ruyi --porcelain`，解析版本化 `ty` 对象并在 adapter 内做兼容。

## 第一阶段 RuyiPort 能力候选
- detect/version/capability
- list/search packages
- install/uninstall/update
- entity/profile list
- venv list/create/remove/activate metadata
- extract
- device/provision（按实际 CLI 能力）
- build/environment inspection（与上游 build feature 对齐）

## 领域 workflow（后期）
`Board → Profile → Toolchain → Sysroot → Venv → Build → Validate`。
Agent 不应只把 `ruyi` 当任意 shell 命令；高频领域操作要有 typed tools，便于权限、结构化结果和 UI 呈现。

## Optional Host Bridge
可以软调用上游命令刷新 Packages/Venv TreeView 等，但：
- 先检测 command 是否存在；
- 失败只 warning，不让核心操作失败；
- bridge 单独放 integration/vscodeHostBridge；
- 上游升级时主要改这里。

## Upstream compatibility
每次升级 `ruyisdk-vscode-extension`：先跑原扩展 regression，再跑 Yisi integration；不要直接在冲突中把 Yisi 逻辑散进上游模块。
