# 21 — 按计划书（docs/12 Roadmap & DoD）已完成部分报告

> **历史快照**：本报告的日期、分支与测试数字（410 tests）是 **2026-09-05 当日**的事实，保留原样以作为当时的证据。**当前状态**（分支、测试数、里程碑进度、新增能力与 ADR）请以 `docs/18_COMPATIBILITY_MATRIX.md` 与 `docs/12_ROADMAP_AND_DOD.md` 为准；两者与 `docs/22_HANDOVER.md` 的当前数字由 `test/docs-consistency.test.js` 守卫。

- **报告日期**：2026-09-05
- **仓库**：`C:\Users\86138\Desktop\0904_项目拓展\Yisi_AI_v0.1.7_vision_pdf_fix_source_with_git(1)`
- **分支**：`fix/vision-pdf-runtime`（HEAD 共 142 个提交；未 push，远端仅存在 `origin/main`）
- **验证状态**：`npm run compile` 通过；`npm test` → **410 tests / 409 pass / 0 fail / 1 skip**（1 skip = Windows symlink 用例）
- **构建产物**：`yisi-ai-dev-starter-0.1.7.vsix`（7,608,621 字节 ≈ 7.26 MiB，运行时依赖已捆绑）
- **依据**：本报告只记录本会话中由工具结果与提交历史可核实的内容。

---

## 1. 总览

| 版本 | 计划书要求 | 状态 | 关键交付 | 提交 |
| --- | --- | --- | --- | --- |
| v0.2 | Coding Agent MVP；DoD：定位→修改提议→批准→验证 | ✅ DoD 达成 | 工具集 + Agent loop + PermissionEngine | `e2a216a` |
| v0.3 | Reliable Editing；DoD：失败测试自动迭代修复 | ✅ DoD 达成 | 失败→修复→再验证 e2e 证据 | `3ec89bd` |
| v0.4 | Git / Parallel Sessions；DoD：写会话不共改同一工作树 | ✅ DoD 达成（+收尾修复） | GitPort / worktree 管理器 / 写会话隔离 | `7551924` `1d723d3` `bb24279` `a23b96e` |
| v0.5 | Ruyi Typed Tools；DoD：不解析人类 CLI 文本 | ✅ 核心达成 | 类型化 porcelain 操作 + `ruyi_manage` + 操作 UI | `36e50da` `856b97c` `6710b63` |
| v0.6 | Ruyi Intelligent Workflow；DoD：真实 Ruyi fixture 端到端 | ⚠️ 前置规划已做；端到端**环境依赖** | `ruyi_workflow` 前置就绪度/缺口报告 | `48dd956` |
| v0.7 | Context & Mature Agent；DoD：长会话不溢出不崩、能力缺失明确降级 | ✅ DoD 达成 | context 压缩 / cost 控制 / repo_index / plan_todo / 能力降级 / history | `1900c67` `73f4393` `c75fd92` `e93109a` `e1186ae` `c170f17` |
| v0.8 | Upstream Integration；DoD：原 RuyiSDK + Yisi regression 全过 | ⛔ **环境依赖**（需上游仓库） | — | — |
| v0.9 | RC：性能/安全/许可证/依赖/迁移/日志 redaction/兼容矩阵 | ✅ 代码级完成 | redaction / NOTICES 守卫 / schema 守卫 / 性能基线 / 兼容矩阵 | `8127b31` `fc1c542` `a288573` `fb4e360` `7f2c7a8` |
| v1.0 | Delivery：VSIX + 安装维护说明 + NOTICE + 测试报告 | ✅ 本机交付完成 | VSIX 打包 + `docs/20` | `fab523d` `a2e85ae` |

横切（不属单一版本）的缺陷修复与 UI 增强见第 4、5 节。

---

## 2. 逐版本完成明细

### v0.2 Coding Agent MVP
- **能力**：受限 Read/List/Search、选区任务（解释/注释/单测）、项目文档任务（README/API）、Agent loop + 工具 schema、`PermissionEngine`（Plan/Manual，并扩展到 Accept Edits/Auto/Full Access）、结构化 `ProcessRunner` + VS Code Diagnostics 快照。
- **DoD 证据**：`test/agent-loop-e2e.test.js` + fixture `test/fixtures/agent-loop-demo/`（`calc.js` 含故意 bug）：read_file → replace_text（Manual 批准被记录）→ 真实 `node calc.test.mjs` 验证通过 → 总结；并验证 Plan 模式在工作区写操作**执行前**拒绝（文件未被创建）。

### v0.3 Reliable Editing
- **能力**：edit/create/delete/rename/mkdir/rewrite + **stale guard**（read 返回的 SHA-256、唯一匹配、原子发布）、批准前 **diff 预览**、`undo_last_edit` + Edit Journal、validation planner（`run_validations`）、loop guard、Stop/Continue。
- **DoD 证据**：`test/agent-loop-fix-iteration.e2e.test.js` + fixture `test/fixtures/agent-loop-fix-demo/`（`multiply` 故意写成 `a + b`）：read → **首次验证 FAIL（exit≠0）** → 依据 sha 修复 → **二次验证 PASS（exit 0）** → 总结，证明"失败测试自动迭代修复"。
- **顺带修复**：既有 e2e 在 `node:test` 内嵌套 `node --test` 会触发 "skipping running files" 造成**假 exit 0**，已改为直接 `node calc.test.mjs`（两处）。

### v0.4 Git / Parallel Sessions
- **`GitPort` + `NodeGitService`**：结构化 `git` 调用、porcelain 解析、`core.quotepath=false`（中文/空格路径）、非 repo 安全返回。
- **`git_status` 工具**（readOnly）：repo/branch/clean/变更文件列表（封顶 300）。
- **dirty worktree 删除保护**：delete/rename 前若目标携带**已跟踪未提交改动**（M/A/D/R/C）则拒绝；纯 untracked（agent 新建）可删；非 git 工作区跳过。
- **`WorktreePort` + `NodeWorktreeManager`** + `git_worktree` 工具：list/create/remove；不假定默认分支；不直接改 `.git/worktrees` metadata；脏 worktree 无 force 拒绝移除并给恢复提示。
- **写会话隔离（DoD）**：`SessionIsolationService` 为 `mode ≠ plan` 的会话建立独立 worktree + 绑定该 root 的 runner，`ChatService` 经 `sessionRunner` 按会话选择 runner。
- **测试**：`test/node-git-service.test.js`、`test/git-status-tool.test.js`、`test/workspace-edit-dirty-guard.test.js`、`test/node-worktree-manager.test.js`、`test/session-isolation.test.js`（真实 git：两个写会话各自隔离 worktree、共享主树保持 `hello\n` 不变、plan 不隔离、cleanup）。
- **收尾修复**（`a23b96e`）：非 git 工作区的写会话原先会抛 `Cannot create a git worktree outside a git repository.` 而整体失败；现先判 `isRepo`、并捕获任何 worktree 创建失败**优雅降级**为共享工作区（恢复 LNX-016）。

### v0.5 Ruyi Typed Tools
- **类型化 `RuyiPort`**：version / listPackages / listProfiles / install / uninstall / **createVenv / removeVenv / createProfile / removeProfile / update / extract**。
- **`RuyiCliAdapter`**：全部经 `ruyi --porcelain`，每行一个 JSON 解析，**从不解析面向人类的 CLI 文本**（DoD）；CLI 语法集中于适配器。
- **`ruyi_manage` 工具**：`risk: environmentChange`（plan 拒 / manual·auto·acceptEdits 确认 / fullAccess 放行）；Agent loop bounded scope 已接纳 `environmentChange`。
- **操作 UI**：侧栏顶栏 **Ruyi 按钮 + popover** 实时显示 Ruyi CLI/包/profile 摘要（`ruyiInspect`→`ruyiState`）；另有 `Yisi AI: Ruyi Environment Check` 命令。
- **测试**：`test/ruyi-cli-adapter.test.js`、`test/ruyi-manage-service.test.js`、`test/ruyi-check-command.test.js`、`test/chat-view-source.test.js`、`test/webview-protocol.test.js`。

### v0.6 Ruyi Intelligent Workflow（前置规划部分）
- **`RuyiWorkflowService` + `ruyi_workflow` 工具**（readOnly）：从 porcelain 数据报告 **Board → Profile → Toolchain → Sysroot → Venv** 就绪度与缺口；**不猜测 board→toolchain 映射**，只标记命名缺口，交由 `ruyi_manage` / `ruyi_check` 决策。
- **测试**：`test/ruyi-workflow-service.test.js`（就绪报告、缺失 profile/toolchain 标记、ruyi 缺失安全降级、工具元数据与 target 清洗）。
- **未完成（环境依赖）**：真实 Ruyi/RISC-V fixture 的端到端 Build/validate 与 Ruyi-aware 错误恢复，需具备 RuyiSDK 的 Linux 主机。

### v0.7 Context & Mature Agent
- **`ContextCompactor`**：超预算时截断最早 turns、保留最近 turns 并前置 system 说明（"Earlier conversation omitted…"）；`estimateTokens` 有界，超大输入不崩。**DoD "长会话不因 context overflow 崩溃" 达成。**
- **cost/context 控制**：`ChatService.historyBudgetRatio`（默认 0.6）——历史只占窗口一部分，可调低以收紧成本。
- **`repo_index` 工具**（readOnly）：有界仓库索引（语言分布/顶层条目），跳过 `.git/node_modules/dist/build/vendor`/隐藏目录与 binary，尊重根 `.gitignore`（basename），受 file/depth/time 预算 + 取消 + symlink 环保护（docs/16 §15）。
- **`plan_todo` 工具**（readOnly）：会话级任务清单（add / in-progress / done / list / clear），仅内存态。
- **`model_capabilities` 工具**（readOnly）：报告所选模型能力并列出**缺失项（degraded）**——**DoD "模型能力缺失有明确降级" 达成。**
- **`session_history` 工具**（readOnly）：会话 turn 数 / 用户·助手计数 / 估算 token，支持 history management。
- **测试**：`test/context-compactor.test.js`、`test/chat-service.test.js`、`test/repo-index-service.test.js`、`test/agent-plan-service.test.js`、`test/model-capabilities-service.test.js`、`test/session-history-service.test.js`。

### v0.9 RC（代码级）
- **日志/错误密钥脱敏** `SecretRedactor`：精确密钥值 + 常见形态（`Authorization: Bearer …`、`api_key=..`、`sk-…`、长 token）→ `[REDACTED]`；已接入 Provider 错误体、`ChatRunCoordinator.safeMessage`、`chatViewProvider` 的 `console.error`。
- **依赖/许可证守卫** `test/dependency-notices.test.js`：每个运行时依赖须登记 `THIRD_PARTY_NOTICES.md`；拦截 native addon。
- **schema/迁移守卫** `test/session-schema.test.js`：合法 v1 round-trip；**拒绝未来/未知 schemaVersion**；拒绝畸形结构。
- **性能基线** `test/performance-sanity.test.js`：estimateTokens / compactHistory / git+Ruyi porcelain 解析在病理输入下有界快速（实测 ~30ms，上限 5s）。
- **兼容矩阵** `docs/18_COMPATIBILITY_MATRIX.md`：engines / OS / 依赖 / 编译打包 / 测试矩阵 / 环境依赖验收清单。

### v1.0 Delivery（本机可交付部分）
- **VSIX 已打包**：`@vscode/vsce` → `yisi-ai-dev-starter-0.1.7.vsix`（≈7.26 MiB；运行时依赖捆绑；`src/test/docs/random.js` 经 `.vscodeignore` 排除；`*.vsix/dist/node_modules` 已 `.gitignore`）。
- **安装/使用/维护/升级说明**：`docs/20_INSTALL_AND_MAINTENANCE.md`。
- **第三方 NOTICE**：`THIRD_PARTY_NOTICES.md`（由测试守卫）；**schema 冻结**（守卫）；**测试报告** = `docs/18` + 本文档。
- **LICENSE + repository**：消除 vsce 告警、打包更规范（`a2e85ae`）。

---

## 3. Agent 工具清单（共 23 个）

只读类：`read_file` `list_directory` `search_text` `repo_index` `inspect_project` `list_symbols` `ruyi_check` `ruyi_workflow` `plan_todo` `session_history` `model_capabilities` `git_status`(读) `git_worktree`(list)
写/执行类（权限门）：`replace_text` `create_text_file` `rewrite_text_file` `delete_file` `rename_file` `create_directory` `undo_last_edit`（workspaceWrite）、`run_command` `run_validations` `git_worktree`(remove)（processExec）、`ruyi_manage`（environmentChange）

---

## 4. 本会话发现并修复的关键缺陷

| # | 现象 | 根因 | 修复 | 提交 |
| --- | --- | --- | --- | --- |
| 1 | Manual 模式"发送后无回复" | `toolConfirmationSummary` 只认识 replace/create，其余需确认工具**连弹窗都没有直接判"用户拒绝"** → 整轮 blocked | 覆盖全部需确认工具 + 通用兜底；按钮统一为 Approve | `3794d99`（曾 revert/reapply：`16f0bb7` `dc4c6ae`） |
| 2 | 报错后"Thinking…"无下文 | `sessionError` 只写 status 行，随后 `publishState` 重建会话把错误清掉 | 先 publish 再补发错误；webview 渲染为**持久红色错误气泡** | `17830e2` |
| 3 | `Provider mixed text and tool calls in one response.` | DeepSeek 合法地在同一轮返回"前言文本 + 工具调用"，传输层/loop 误判非法 | 传输层与 loop 均接受，前言作为 assistant content 保留 | `bd273a8` |
| 4 | 确认弹窗是全窗口模态框 | 使用 `vscode.window.showWarningMessage({modal:true})` | 改为**侧栏内联批准卡片**（`ApprovalBroker`） | `d79247e` |
| 5 | 长响应无提示 | 无 Provider 超时/提示 | **只提示不中断**的 90s 慢响应提示 + 连接失败重试一次（指数退避） | `46fd482`（期间曾按用户要求移除 60s 强杀 watchdog：`4cc26c5`→`3980f7e`） |
| 6 | 非 git 工作区写会话整体失败 | 隔离逻辑未先判 `isRepo` | 先判 repo + 创建失败优雅降级 | `a23b96e` |

---

## 5. UI / 交互增强

- **复制按钮**：助手/用户消息气泡 hover 显示 ⧉，复制**纯文本**（含成功 ✓/失败 — 反馈与降级）。`7043f2a`
- **工具执行透明化**：模型流式文本按"轮"分段显示，每个工具作为独立**步骤气泡**（`🔧 name` + 输入 → `✓/✕ 结果`），而不是只给最终答案。`17830e2`
- **批准卡片 diff 预览**：replace/rewrite/create 在批准前显示 `+/-` 统一 diff。`17830e2`
- **Ruyi 状态 popover**：顶栏 ◈ 实时查看 Ruyi 环境。`6710b63`

---

## 6. 未完成 / 环境依赖（如实说明）

| 项 | 原因 |
| --- | --- |
| v0.8 合并进上游 `ruyisdk-vscode-extension` + 原 RuyiSDK regression + one-VSIX 集成 | 本机无上游仓库 |
| v0.6 真实 Ruyi / RISC-V fixture 端到端 workflow | 本机为 Windows 开发机、未安装 ruyi |
| v1.0 正式发布（Linux LNX-001..020 smoke、最终 release） | 需目标 Linux/发布环境 |
| v0.1 真实云账号联网人工验收 | 需真实账号与网络（继承自 v0.1 说明） |
| VSIX 完整 bundle 化 | 需引入 esbuild；attachment 提取器对 mammoth / pdfjs(legacy worker) 的**懒加载动态 require** 存在打包风险，未强行引入（仅剩"未 bundle"性能提示） |

以上均记录于 `docs/18`，**未扩张为已完成能力**。

---

## 7. 如何验证

```bash
npm ci                 # 安装依赖
npm run compile        # tsc -> dist/
npm test               # 期望：410 tests / 409 pass / 0 fail（1 skip = Windows symlink）
npx vsce package --no-yarn   # 期望产出 yisi-ai-dev-starter-0.1.7.vsix
```

重点 e2e：
```bash
node --test test/agent-loop-e2e.test.js            # v0.2 DoD：定位→提议→Manual 批准→真实验证
node --test test/agent-loop-fix-iteration.e2e.test.js  # v0.3 DoD：失败→修复→再验证通过
node --test test/session-isolation.test.js         # v0.4 DoD：两写会话隔离、主树不变
```

---

## 8. 结论

- 计划书 **v0.2 / v0.3 / v0.4 / v0.5（核心）/ v0.7 / v0.9（代码级）/ v1.0（本机交付）** 的 DoD 与能力**已在代码、测试与文档层面完成并验证**（410/409/0），并已产出可安装的 VSIX 与安装维护文档。
- **v0.6** 已完成前置规划能力，端到端 DoD 待真实 Ruyi 环境；**v0.8 与 v1.0 正式发布**严格依赖上游仓库与 Linux/发布环境，本机无法完成，已在 `docs/18` 标注为环境相关验收项。
