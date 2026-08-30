# 10 — UI / UX Specification

## 主界面
Sidebar/Webview：会话列表 + 当前 conversation + composer。输入区附近持续可见：当前模型、权限模式、运行状态。

## 设置齿轮
进入 Provider 管理向导：Provider → Base URL → Credential Source(SecretStorage/env) → API Key（若需要）→ Model → Test Connection → Save。

聊天区模型下拉只用于快速选择“已配置可用模型”；旧 Session provider unavailable 时显示错误，不偷偷替换。

## Conversation UI types
不同 item 用不同视觉语义：tool call、diff、permission、terminal、validation、Ruyi operation。避免所有内容都渲染成 Markdown 气泡。

## Diff
展示文件名、增删统计、可展开 diff；Manual 提供 Accept/Reject；自动模式仍提供 Undo/查看。

## Terminal tool item
命令、cwd、running/success/fail、关键输出、展开完整输出、Open in Terminal、Stop。

## Quick tasks v1
分析当前项目、修复编译错误、解释选中代码、优化/重构、配置 Ruyi 环境、检查 Ruyi/Toolchain/Venv、运行构建与测试。以后再做项目智能推荐和用户自定义。

## @ context
composer 输入 `@` 搜索 file/folder/symbol；folder 作为 scope chip。Selection 可通过 editor context menu “Send to Yisi”。

## Worktree indicator
隔离会话明显显示 `Isolated worktree` 与路径/branch；切回 current workspace 属显式操作。
