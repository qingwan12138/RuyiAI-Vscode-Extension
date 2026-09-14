# 22 — 项目交接文档（Handover）

- **交接日期**：2026-09-05
- **项目**：Yisi AI — 面向 RuyiSDK / RISC-V 的 VS Code Coding Agent（闭源横向项目）
- **仓库路径**：`C:\Users\86138\Desktop\0904_项目拓展\Yisi_AI_v0.1.7_vision_pdf_fix_source_with_git(1)`
- **当前分支**：`fix/vision-pdf-runtime`（本地；远端 `origin` = `https://github.com/qingwan12138/RuyiAI-Vscode-Extension.git`，**本分支从未 push**）
- **验证状态**：`npm run compile` 通过；`npm test` → **414 tests / 413 pass / 0 fail / 1 skip**（1 skip = Windows symlink 用例）
- **构建产物**：`yisi-ai-dev-starter-0.1.7.vsix`（≈7.6 MB，已捆绑运行时依赖）

> 本文件与 `docs/21_COMPLETED_WORK_REPORT.md`（完成情况报告）、`docs/12_ROADMAP_AND_DOD.md`（计划书与 DoD）、`docs/18_COMPATIBILITY_MATRIX.md`（兼容矩阵）配套阅读。

---

## 1. 项目目标与交付形态

- **产品定位**：RuyiSDK / RISC-V 开发场景下的 VS Code Coding Agent（Agent 能读/改/跑/验证工作区代码，并具备 Ruyi 感知）。
- **最终交付形态**：**一个 VSIX**（保留上游 `ruyisdk-vscode-extension` 能力 + 嵌入闭源 Yisi AI 模块）。
- **当前正式运行环境**：**Linux 本机 VS Code**（docs/16）。架构保留 `ExecutionWorkspace` / `PlatformAdapter` / `ProcessRunner` / `GitPort` / `RuyiPort` 抽象，以便未来扩展 Remote，但**当前不实现 Remote-SSH**。
- **自研语言约束**：TypeScript / JavaScript（优先 TS）。允许通过 Port/Adapter/Process 调用 `ruyi`、`git`、`gcc/clang`、`cmake` 等外部工具；**默认不引入 native addon / 第二套运行时**（需先做 ABI/架构/许可/打包评估）。

---

## 2. 架构与分层契约（务必遵守）

```
ui  ->  application  ->  domain
infrastructure  ->  domain ports
```

- **domain 不依赖 vscode、不依赖具体 LLM SDK/数据库/上游 UI**。
- Webview 与扩展宿主之间只通过 **typed protocol**（`src/yisi/ui/webviewProtocol.ts`）通信；Webview 不得直接读文件/spawn shell/调 ruyi。
- **绝不让 LLM 决定是否绕过 Permission Engine**。
- 禁止 fork/复制开源 Coding Agent 的代码；参考项目只用于学习**行为与架构思想**（见 `docs/04`）。
- API Key 只存 **SecretStorage**，禁止写入 settings.json / 日志 / 会话 JSON。

### 目录 / 模块地图

| 路径 | 职责 |
| --- | --- |
| `src/yisi/index.ts` | 扩展激活与**组装层**：装配 session/provider/chat/工具/视图，注册命令 |
| `src/yisi/domain/` | 纯领域：session、providerConfiguration、tool、process、gitPort、worktreePort、modelCapabilities、modelContextWindow、providerDefaults |
| `src/yisi/application/` | 用例：chat、agent（loop/runner/registry/plan/approval）、edit、process、validation、context、ruyi、git、workspace、security |
| `src/yisi/infrastructure/` | 适配器：llm（OpenAI 兼容/Anthropic）、persistence、process、context、git、attachment（pdf/docx/xlsx/pptx…） |
| `src/yisi/vscode/` | VS Code 适配：provider 向导、workspace 选择/附件选择、diagnostics、symbols、command 确认、secret store |
| `src/yisi/ui/` | Webview：HTML/脚本、协议、协调器、批准桥、Markdown 渲染 |
| `test/` | 全部单测 + e2e（`node --test`）；fixture 在 `test/fixtures/` |
| `docs/` | 00 起步、02 架构契约、12 计划与 DoD、16 Linux、17 语言与依赖、18 兼容矩阵、20 安装维护、21 完成报告、**22 本文档** |

---

## 3. 完成情况（对照 docs/12）

| 版本 | 状态 | 说明与证据 |
| --- | --- | --- |
| v0.1 | ✅ | 激活/会话持久化/SecretStorage/Provider 配置/SSE 流式。真实云账号联网验收为环境项 |
| v0.2 | ✅ DoD | 工具 + Agent loop + PermissionEngine(Plan/Manual)；e2e `test/agent-loop-e2e.test.js` |
| v0.3 | ✅ DoD | 编辑/删除/重命名/目录 + stale guard + 批准前 diff + undo/Journal + validation planner；"失败测试自动迭代修复" e2e `test/agent-loop-fix-iteration.e2e.test.js` |
| v0.4 | ✅ DoD | `git_status`/`git_worktree` + dirty-worktree 删除保护 + worktree 管理器 + **写会话隔离执行**（`SessionIsolationService`） |
| v0.5 | ✅ 核心+UI | 类型化 porcelain 操作 + `ruyi_manage`（environmentChange 权限门）+ Ruyi 状态 popover + 检查命令 |
| v0.6 | ⚠️ 前置规划✅ | `ruyi_workflow` 报告 Board→Profile→Toolchain→Sysroot→Venv 就绪度/缺口；**端到端 DoD 需真实 Ruyi 环境** |
| v0.7 | ✅ DoD | context 压缩防溢出 + `historyBudgetRatio` + `repo_index` + `plan_todo` + `model_capabilities` 降级 + `session_history` |
| v0.8 | ⛔ 未完成 | 合并进上游 `ruyisdk-vscode-extension` + 原 RuyiSDK regression（**需上游仓库**） |
| v0.9 | ✅ 代码级 | 密钥脱敏 + 依赖/许可证守卫 + schema 迁移守卫 + 性能基线 + 兼容矩阵 |
| v1.0 | ✅ 本机交付 | VSIX 打包 + `docs/20` 安装维护 + NOTICE + schema 冻结守卫 + 测试报告；**正式发布需目标环境** |

**Agent 工具（23 个）**
- 只读：`read_file` `list_directory` `search_text` `repo_index` `inspect_project` `list_symbols` `ruyi_check` `ruyi_workflow` `plan_todo` `session_history` `model_capabilities` `git_status` `git_worktree`(list)
- 写/执行（权限门）：`replace_text` `create_text_file` `rewrite_text_file` `delete_file` `rename_file` `create_directory` `undo_last_edit`（workspaceWrite）、`run_command` `run_validations` `git_worktree`(remove)（processExec）、`ruyi_manage`（environmentChange）

---

## 4. 关键设计决策与已知坑（接手必读）

1. **PDF 解析**：用 `pdfjs-dist@4.10.38`，经**真实动态 `import('pdfjs-dist/legacy/build/pdf.mjs')`** 加载（4.x 起 **没有** CJS 构建，不能 `require`），并设置 `GlobalWorkerOptions.workerSrc`（指向 `…/pdf.worker.mjs`）+ 把 worker 模块预载到 `globalThis.pdfjsWorker`。两处必须记住的纠正：
   - **安全下限**：3.11.174 及所有 `<4.2.67` 存在 **CVE-2024-4367 / GHSA-wgrm-67xf-hhpq**（打开恶意 PDF 即可执行攻击者 JS）；上游在 4.2.67 移除了该 `eval` 路径。**不要回退到 3.x**。提取器同时始终传 `isEvalSupported: false`（该漏洞的运行时兜底，也不要动）。
   - **旧结论已推翻**：本文档早前写的“4.x ESM 在扩展宿主不可用、必须用 3.x”是**误判**。当初 4.x 失败的真实原因是 worker 自举需要 DOM/shim；而那套修复（`workerSrc` + `globalThis.pdfjsWorker` 预载）是在改用 3.x **之后**才发明的，只被套用到了 3.x 路径。同样两个修复套到 4.x 上即可正常工作（见 `test/pdf-real-extractor.test.js` 的真实依赖端到端验证）。
   - **5.x/6.x 暂不可用**：它们声明 `engines.node >=22.13`，而 `engines.vscode ^1.95.0` 的宿主是 Electron 32 / Node 20.18.1。要升 5.x/6.x 必须先抬高 `engines.vscode` 并重新在 VS Code 里验证。
   - 回退守卫：`test/pdf-real-extractor.test.js` 同时断言版本下限与宿主 Node 兼容性。
2. **附件重活**：docx（mammoth）/pdfjs 为**懒加载**（首次附加才加载），会造成扩展宿主 ~1-2s 停顿；已加"首次附加提示"。**不要**把它们静态打包进 bundle（见 §6）。
3. **错误可见性**：`sessionError` 必须在 `publishState` **之后**发出，否则 Webview 重建会话会把错误清掉（表现为"Thinking… 后无下文"）。webview 侧现在渲染**持久红色错误气泡**。改动此顺序会复现该 bug。
4. **"文本 + 工具调用"同轮**：DeepSeek 等模型会在同一轮返回前言文本 + tool_calls，这是**合法**的；传输层与 loop 都已接受，前言作为 assistant content 保留。不要恢复"mixed → 报错"。
5. **Manual/Auto 确认**：`toolConfirmationSummary` 必须覆盖**所有**需确认工具（含 run_command/rename/delete/mkdir/undo/run_validations），否则会**静默拒绝**并整轮 blocked。
6. **写 session 隔离**：只在 **git 仓库**内做 worktree 隔离；非 git 工作区或 worktree 创建失败必须**优雅降级**为共享工作区（否则普通文件夹无法用 Agent）。
7. **context 压缩触发条件**：仅当 provider 声明 `capabilities.maxContextTokens` 时生效；预算 = `window × historyBudgetRatio(默认 0.6) − CONTEXT_OVERHEAD(2000) − 当前轮`。窗口未知则不压缩。
8. **权限风险类型**：`readOnly` / `workspaceWrite` / `processExec` / `environmentChange` / `destructive` / `credentialSensitive`。loop 的 bounded scope 接纳前四类中的 readOnly/workspaceWrite/processExec/environmentChange，且**始终经 PermissionEngine**（plan 拒绝；manual/auto/acceptEdits 确认；fullAccess 放行，destructive/credentialSensitive 仍确认）。**模型必须被告知当前模式**：`AgentToolLoop.run()` 每次运行会把一份 system 简报（`application/agent/permissionModePrompt.ts`）插在**保留历史之后、当前用户轮之前**（不是会话首条——保持可缓存前缀）。措辞**不得**写成"不要尝试"：DSH 记录过这种禁止式框架导致 **soft lockout**（模型不再尝试"被拒但可升级"的工作、零工具调用空转）。简报**只是告知**、不参与判定（引擎仍是唯一闸门，见 docs/07）；其措辞与 `PermissionEngine.evaluate` 的一致性由 `test/permission-mode-prompt.test.js` 用真实引擎耦合校验。
8b. **被拒不终止整轮**（三家收敛，见 docs/04）：`AgentToolLoop` 把拒绝写成 `role: 'tool'` 的结果 `{ok:false, denied:true, reason:'policy'|'user'|'unavailable', error, guidance}`——三种理由必须可区分（策略拒绝 / 用户拒绝 / 无审批通道）。**必须有界**：连续 3 次或累计 20 次 → 停止并把控制权交回用户（`maxConsecutiveDenials`/`maxTotalDenials`，阈值取自 CC 公开数字；Codex 为 3/50内10）。成功执行会重置连续计数。**终止只保留给协议级违规**：未知工具、超出有界范围、重复调用无进展、轮次/预算耗尽。注意"策略拒绝是约束生效，不是运行失败"。**v0.2 DoD 测试已随之更新**：`test/agent-loop-e2e.test.js` 的断言从"抛错"改为"文件未被创建 + 模型收到 `reason: 'policy'` 的拒绝"，核心性质（Plan 绝不写盘）不变。
8c. **一次性权限升级 = Plan 模式的被审阅退出**：模型可调用 `request_permission{mode, justification}` 请求把**本次运行**的模式放宽。四处硬约束（在 `AgentToolLoop` 内实现，工具本身 `execute` 永远抛错、**绝不执行**，其 `risk: 'readOnly'` 不参与判定）：**只能跟在策略拒绝之后**（`reason: 'policy'`；跟在**用户主动拒绝**之后一律拒绝并提示"用户已拒绝，不要再要求放宽"——参考实现的升级针对约束拦截而非人的拒绝，不收紧就变成纠缠）、**必须严格更宽**（`domain/permissionMode.ts` 的 `isWiderPermissionMode`）、**每次运行仅一次**、**必须有人批准**（复用同一张审批卡片；无通道则 `unavailable` 失败关闭）。批准只作用于**本次运行**，**不改会话存储的模式**；批准后连续拒绝计数清零。工具定义在 `application/agent/requestPermissionTool.ts`，在 `index.ts` 的 `buildAgentRunner` 注册；`YisiTool.permissionEscalation` 这个可选标记是 loop 识别它的依据（不要用硬编码工具名匹配）。**尚未实现**：CC/DSH 那种专门的计划审阅面板（计划渲染成文档 + 内联评论 + 选项各自切不同模式）。
9. **窗口/能力表**：`modelContextWindow`（DeepSeek 四个可调用 id `deepseek-flash` / `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 都是 **1M**；`deepseek-chat` / `deepseek-reasoner` 是 64k）、`modelCapabilities`（DeepSeek 的视觉模型是 **`deepseek-flash`**（= DeepSeek-V4.1-Flash），它 id 里**没有** vision 标记，因此靠 `DEEPSEEK_VISION` 显式表判定；`deepseek-v4-pro` 不支持图像）、`providerDefaults`（`KNOWN_MODELS` 表：`current` = 官方阵容 `deepseek-flash` + `deepseek-v4-pro`，`legacy` = 已下线但仍可调用的 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`，其 `servedBy` 指向 `deepseek-flash`）都在 **domain 纯模块**，不要把模型命名规则散到 Webview 或 vscode 层。**三条不能破坏的行为**：(a) 发现模型必须用 `mergeDiscoveredModels()` **取并集**而非替换——官方 `GET /models` 只返回当前 2 个，替换会让旧名从选择器里消失（而 API 仍接受它们，DeepSeek 自家 harness 也把它们列出来）；(b) **已保存的配置也要暴露旧名**：`ProviderConfigurationService.offeredModels()` 在**读时**把已知目录并入存储清单，**不改写用户已保存的配置**——凡是要把"存储的模型"变成"用户能看见/能选的模型"的地方都必须走这个入口（`ModelControlService.getState()` 与 `isAvailable()` 已走），只改写入路径（向导）是不够的：老配置会永远停在 2 条；(c) 旧名必须在 UI 里**带标记**出现（`ModelControlModelView.legacyOf` → 弹层显示"旧名"徽标 + tooltip 说明路由），不能悄悄当成当前模型展示。守卫：`test/provider-defaults.test.js`（含向导调用点的源码级断言，因为向导 import vscode 无法直接 require）+ `test/model-control-service.test.js` 里"存储 2 条 → 读到 4 条 且旧名可选"的用例。
10. **图标限制**：活动栏可用自定义 SVG；**editor/title 与状态栏只接受 codicon / 图标字体**（`contributes.icons` 需 `fontPath + fontCharacter`，id 必须形如 `component-iconname`）。
11. **不要自动恢复长进程**：会话中断只能记录 + 让用户 Resume（软恢复：启动时提示"继续"并重发最后一条消息）。
12. **不要默认读 `.gitignore` 内容**（用户显式引用除外）。
13. **会话自动命名**：新会话标题是占位 `New Chat`（`titleSource: 'fallback'`）。首次拿到模型回复后，`ChatService.applyAutoTitle()` 用**同一条 provider 通道**发一次 **bare 请求**（system 指令 + 第一轮问答，无工具、无历史，`temperature:0`，流式结果丢弃不显示），再经 `SessionService.setAiTitle()` 落库为 `titleSource: 'ai'`。四个不可破坏的约束：(a) **用户改过的名字永远优先**（`manual` 直接拒绝覆盖——用户在请求飞行途中重命名是真实竞态）；(b) **只命名一次**（`fallback` 之外都不再触发）；(c) **绝不因命名失败而让成功的 run 变成失败**（全程 try/catch，失败就保留占位名）；(d) **不要给这个请求加 `maxTokens` 上限**——DeepSeek 当前模型默认**思考模式**，思考以 `reasoning_content` 而非 `content` 返回，而 `openAICompatibleProvider.textDeltas()` 只读 `content`，于是 provider 会把"整条流没有 content"判为 `Provider returned an empty response.` 抛错；小上限会被思考吃光、标题永远出不来（这就是"交流完还是 New Chat"的根因）。长度由 system 指令约束，不由 token 上限约束。**失败必须留日志**（`[Yisi AI] Session auto-title failed: …` / `… produced no usable title`，经 secret redactor），不要恢复成裸 `catch {}`——静默失败会让这个问题无法诊断。开关 `yisiAI.sessionAutoTitle`（默认 true，每会话多一次请求）。注意 `ChatService` 的 `autoTitle` 策略**缺席即视为关闭**，所以既有调用点/测试不受影响，接线只在 `index.ts` 组合根。

---

## 5. 本地构建 / 测试 / 打包

```bash
npm ci                 # 按 package-lock 安装
npm run compile        # tsc -> dist/   （等价 npm run check 只做类型检查）
npm test               # 期望 414 tests / 413 pass / 0 fail（1 skip = Windows symlink）
npx vsce package --no-yarn   # 产出 yisi-ai-dev-starter-0.1.7.vsix
```

开发调试：仓库根 `.vscode/launch.json` → F5 启动 **Extension Development Host**（`--extensionDevelopmentPath=${workspaceFolder}`），随后在宿主窗口里 **Open Folder 打开一个本地文件夹**（**恰好一个**，多根/无 folder 会禁用 Agent 工具），再从活动栏打开 Yisi AI。

**DoD 快速验证**
```bash
node --test test/agent-loop-e2e.test.js             # v0.2：定位→提议→Manual 批准→真实验证
node --test test/agent-loop-fix-iteration.e2e.test.js  # v0.3：失败→修复→再验证通过
node --test test/session-isolation.test.js          # v0.4：两写会话隔离、主树不变
```

---

## 6. 未完成 / 环境依赖（如实）

| 项 | 阻塞原因 | 需要什么 |
| --- | --- | --- |
| v0.8 合并进上游 + 原 RuyiSDK regression + one-VSIX 集成 | 本机无上游仓库、无网络/凭据 | 上游 `ruyisdk-vscode-extension` 仓库访问权 + 能 push/开 PR 的环境 |
| v0.6 真实 Ruyi / RISC-V fixture 端到端 | 本机为 Windows 开发机、未装 ruyi | 一台 Linux + RuyiSDK 机器 |
| v1.0 正式发布（LNX-001..020 smoke、最终 release） | 需目标 Linux/发布环境 | 目标环境 + 发布流程 |
| v0.1 真实云账号联网人工验收 | 需账号/网络 | 可用的 Provider 账号 |
| VSIX **完整 bundle 化**（当前 7.6MB，vsce 提示未 bundle） | 引入 esbuild 需处理 mammoth/pdfjs **懒加载动态 require**，静态打包有破坏风险 | 明确接受该风险后再做 |
| Ruyi 面板的**变更操作按钮**（现只读状态；变更走 `ruyi_manage` + 批准卡片） | 属可选增强 | 需求确认 |

**其他未跟踪文件**（未纳入版本库，打包时已排除）：`random.js`、`gen_random_numbers.js`。

---

## 7. 下一步建议（优先级）

1. **提供上游仓库与环境** → 完成 v0.8（把 `fix/vision-pdf-runtime` 的提交整理成 PR、跑原 RuyiSDK regression、合并为 one VSIX）。
2. **提供 Linux + RuyiSDK 机器** → 完成 v0.6 端到端 workflow 与 LNX-001..020 smoke。
3. 视需要做：VSIX bundle 化、Ruyi 面板变更操作、把 `modelContextWindow` 兜底也用于 context 压缩（当前仅用 `capabilities.maxContextTokens`）。
4. 分支策略：当前分支领先 `main` 84 个提交且**未推送**；建议确认后 `git push -u origin <branch>` 并开 PR（需要有效的 GitHub 凭据；本机 `gh` 未安装、无 token 环境变量）。

---

## 8. 交接清单

- [x] 计划书与 DoD：`docs/12`
- [x] 完成报告：`docs/21`
- [x] 兼容矩阵 / 环境依赖清单：`docs/18`
- [x] 安装/使用/维护/升级：`docs/20`
- [x] 第三方 NOTICE：`THIRD_PARTY_NOTICES.md`（由 `test/dependency-notices.test.js` 守卫）
- [x] 全量测试可跑通：`npm test` → 414/413/0
- [x] 可安装产物：`yisi-ai-dev-starter-0.1.7.vsix`
- [ ] 上游合并 / 正式发布（见 §6，需环境）
