# 22 — 合同任务差距分析（RISC-V合同.pdf ↔ Yisi AI v0.1.7）

> 依据：《技术服务合同》（项目名称：RuyiSDK IDE 代码智能分析与生成插件开发；委托方：中国科学院软件研究所；受托方：合肥工业大学；服务费 80 万元；期限：合同签订之日起至 2026-10-31）。
> 范围：只分析合同中与"RuyiSDK IDE AI 助手插件"（成果 5）直接相关的差距。模型微调、数据集、第三方测试等任务只保留与本插件集成有关的边界。
> 状态基线：Yisi AI v0.1.7（HEAD 3e84d54，vision/pdf fix 之后）。
> 本文件是"需求对账"文档，不是 DoD；每个 P0 项完成时应回填状态与验证证据。

## 1. 合同要求速览（与插件相关的部分）

| 编号 | 合同条款 | 要求 |
|---|---|---|
| 内容-2 | 第一条.2 | 开发 RuyiSDK IDE AI 助手插件：C/C++/Java 测试用例、README 文档、代码注释自动生成 |
| 内容-3 | 第一条.2 | 构建模型推理方案：优先本地 RISC-V 设备推理，兼容云端资源 |
| 内容-4 | 第一条.2 | 通过编程语言适配性测试提高输出质量 |
| 指标-1 | 第一条.3 | 微调模型（≥ DeepSeek-R1-Distill-Qwen-1.5B）集成进 IDE，开发者可在 IDE 内直接唤起 |
| 指标-2 | 第一条.3 | 开源适配：llama.cpp / buddy-compiler 运行，无闭源代码依赖 |
| 指标-3 | 第一条.3 | 本地 RISC-V 设备 tokens 生成速率 ≥ 10 tokens/s |
| 指标-4 | 第一条.3 | C/C++/Java 测试用例生成、README 自动生成、代码注释生成 |
| 指标-5 | 第一条.3 | 模型可移植性：如意香山南湖笔记本、如意 AIPC 等设备正确运行 |
| 成果-1 | 第一条.4 | LLM 微调 + 在程序员反馈指导下生成单元测试用例，提供源代码 |
| 成果-2 | 第一条.4 | 代码片段注释生成（按开发者提示词），提供源代码 |
| 成果-3 | 第一条.4 | 项目说明文件 / API 文档生成（按开发者提示词），提供源代码 |
| 成果-4 | 第一条.4 | 技术文档 1 份 + 第三方测试报告 1 份 |
| 成果-5 | 第一条.4 | RuyiSDK IDE AI 助手插件：集成上述 1/2/3，提供源代码 |

非技术条款（周报、周例会、里程碑验收、10 工作日默认验收通过、保密、成果归属、违约金）属于项目管理侧，本文件只在"验收证据"维度引用。

## 2. 插件现状对账（v0.1.7 代码基线）

### 已具备（可支撑合同）

- 侧栏 Webview Chat：会话持久化（全局存储）、历史切换/重命名/删除、Stop/Continue、每会话权限模式与模型记忆。
- Provider：OpenAI / OpenAI-compatible / Anthropic / DeepSeek / llama.cpp 五类；密钥走 SecretStorage/env；流式 SSE；tool calling / vision / reasoning 能力门控；OpenAI 强制 HTTPS。
- 受限 Agent：单一本地工作区下 `read_file` / `list_directory` / `search_text`（只读）+ `replace_text`（SHA-256 stale-guard 唯一替换）+ `create_text_file`（排他新建）；类型化 PermissionEngine（plan/manual/acceptEdits/auto/fullAccess）；写入附带工作区限定 diagnostics 快照。
- 多格式附件：文本/代码/markdown、PDF、DOCX、PPTX、XLSX/CSV、ipynb、图片（双层 vision gate），token 预算公平分配，会话只存引用。
- 基建已实现但未接线：`NodeProcessRunner`（shell:false、双流限量、超时/取消、Linux 进程组 SIGTERM→grace→SIGKILL）、`ValidationEngine`、`RuyiCliAdapter`/`RuyiPort`。

### 主要差距（P0/P1/P2，见 §3）

## 3. 差距项与建议

### P0 —— 对应合同成果 1/2/3 与指标 4（验收核心）

| # | 差距 | 现状证据 | 建议落地 |
|---|---|---|---|
| G1 | 无编辑器原生入口（右键/命令/选区），所有任务只能在侧栏手敲 | `package.json` 仅 4 个无参命令；UI 无 test/comment/readme 动作 | 编辑器 context menu + Command Palette：为选区生成注释/单元测试/解释；选区携带语言与符号上下文；接入现有 Chat/Agent 链路 |
| G2 | 无命令执行 → 无法编译/跑测试做质量闭环，无法支撑"程序员反馈指导下生成单测" | `NodeProcessRunner` 等已实现未接进 Agent（index.ts 只挂 5 个只读/编辑工具） | 接 `run_command`（结构化 executable/args/cwd，shell:false）为 processExec 风险工具；plan 拒绝/manual 确认/auto·acceptEdits 确认/fullAccess 放行；输出限量，结果结构化回喂模型 |
| G3 | 编辑面窄：无删除/重命名/建目录/整文件重写；agent 轮次上限 8 轮×16 次调用 | `workspaceEditService.ts` 仅 replace/create | 补删/重命名/目录工具；agent 自建文件允许整文件重写；轮次预算弹性化 |
| G4 | 无语言适配层：不感知 C/C++/Java 测试框架与注释规范 | 工具纯文本读/写，无框架探测 | 目标语言提示模板 + 框架探测（CMake/ctest/gtest、JUnit/Maven/Gradle）；语言适配性评测脚本产出报告（对接成果 4） |

### P1 —— 对应指标 1/2/3/5（模型与设备集成面）

| # | 差距 | 现状证据 | 建议落地 |
|---|---|---|---|
| G5 | 本地 RISC-V 设备/云端推理无"一键接入" | Provider 已支持 llamaCpp/openaiCompatible，配置全手填 | 本地设备预设向导（如意香山南湖笔记本/如意 AIPC）：baseUrl + testConnection 健康检查 + 离线提示 + 速度档位显示 |
| G6 | Ruyi 集成未接线 | `ruyiCliAdapter.ts`/`ruyiPort.ts` 实现存在但无引用 | 至少打通 `ruyi --porcelain` 只读查询（环境/device/工具链）为一个只读工具；作为并入上游 ruyisdk-vscode-extension 的稳定 seam |
| G7 | 微调模型服务无标准化登记入口 | 模型全靠手填配置 | "模型服务登记"：模型名/中文+代码能力/上下文/端点，微调产物可被 IDE 一键唤起 |

### P2 —— 质量/工程/治理

| # | 项 | 说明 |
|---|---|---|
| G8 | 演示与验收准备 | 距 2026-10-31 约 2 个月；里程碑验收制。建议维护 1–2 个 RISC-V 示例工程（C+CMake+ctest、Java 单测）作 demo 基线，功能改动附可运行演示，进周报 |
| G9 | 交付口径确认（非技术） | 合同成果 5 要求"提供源代码"，仓库标记 UNLICENSED 闭源。集成插件的源码交付口径需项目负责人与甲方尽早对齐，避免验收争议 |
| G10 | Linux 验收矩阵 | docs/16 LNX-001~020：进程树 smoke（LNX-012/013/014）、路径中文/空格（LNX-005）等仍未在真实 Linux 环境验收，建议随里程碑补跑并留证据 |

## 4. 实施顺序建议（按剩余工期）

1. G1 编辑器选区命令 + 注释/单测/解释（P0，先于 G2：它产出"任务入口"）。
2. G2 run_command 接线（P0，质量闭环依赖）。
3. G4 语言适配层最小版（先做 C/C++ 测试框架探测与提示模板）。
4. G5/G7 设备与模型预设向导；G6 ruyi 只读查询。
5. G8/G10 演示 + Linux 验收证据，随周报/里程碑输出。

## 5. 状态记录

| 日期 | 变更 |
|---|---|
| 2026-09-03 | 建档：基于 RISC-V合同.pdf（OCR 提取文本见工作区 `RISC-V合同_OCR提取文本.txt`）与 Yisi AI v0.1.7 源码逐条对账 |
| 2026-09-03 | G1（编辑器选区命令）落地：`yisiAI.selection.explain/comment/unitTests` 三个命令 + editor/context 菜单；链路 = vscode 选区适配 → 纯提示词组装（`application/chat/editorSelectionTask.ts`，单测 6 个）→ 复用 Chat/Agent run（`chatViewProvider.runEditorSelectionTask`）。未改动 Webview 渲染协议，选区任务作为普通会话轮次持久化。 |
| 2026-09-03 | G2 阶段一（结构化命令执行）落地：`application/process/commandExecutionService.ts` + `run_command` 工具（risk `processExec`）；agent loop 放行 processExec 并保持权限门（plan 拒绝 / manual·acceptEdits·auto 需确认 / fullAccess 放行；特权与系统/包管理器可执行文件工具层硬拒；cwd 限制在工作区内）。对应更新 `readOnlyAgentLoop.ts` 边界与测试。自动验证闭环（ValidationPlanner 按项目自动跑 build/test）仍未实现，属于 G2 后续阶段。 |
| 2026-09-03 | G4（语言/构建/测试框架探测）落地：纯 TS 探测器 `application/context/projectProfileDetector.ts`（语言/构建系统/测试框架带证据文件与置信度 + 建议命令）+ `ProjectProfileService`（FileSystemPort 扫描根与常见 src/tests 目录并解码清单文件）+ 只读 Agent 工具 `inspect_project`；选区 unitTests 提示词在可行时附带探测摘要（`buildSelectionTaskMessage` 可选第三参）。新增测试 14 个（探测器 8 / 服务 4 / 提示词 2）。单测 258/258 通过。仍待：按框架做深度内容扫描（搜索标记 token）、嵌套多模块识别。 |
| 2026-09-03 | G3（编辑工具扩展）落地：`delete_file`/`rename_file`/`create_directory`/`rewrite_text_file`（仅允许整文件重写 agent 本轮自建文件，需 `read_file` sha256 stale guard）。`WorkspaceWritePort` 与 `NodeWorkspaceFileSystem` 新增 4 个写操作：原子写、保留 mode、敏感路径与 symlink 保护、目标不覆盖、目录逐段创建并 realpath 防逃逸。agent-created 账本在 `WorkspaceEditService` 内随 create/delete/rename 维护。新增测试 8 个（fs 4 / service 2 / 既有文件更新 2）。单测 263/263 通过（1 skip 为本机 symlink 权限）。仍待：修改 diff/Undo（G3 后续，见路线图 v0.3）。 |
| 2026-09-03 | G3 后续（写操作 journal + undo）落地：`editJournal.ts`（多重集行级变更摘要、有界 journal 上限 6 条、64KB 内容保留上限）+ `WorkspaceEditService` 记录每次写操作并在 `undo_last_edit` 工具中 LIFO 回滚（create/delete/replace/rewrite/rename；回滚前 sha stale guard；超大文件与建目录诚实报告不可自动回滚）。新增测试 8 个。单测 271/271 通过（1 skip 为本机 symlink 权限）。仍待：Webview 内可视化 diff/Undo 面板（接入 journal 的变更摘要，UI 层工作）。 |
| 2026-09-03 | G2 阶段二（验证闭环，模型驱动切片）落地：`validation/commandPlan.ts`（把探测器建议命令字符串转成结构化 argv 执行计划：`&&` 链拆分、`./gradlew`→bash、引号保留、拒绝特权/无法结构化表达的头部）+ `ValidationPlannerService` + `run_validations` 工具（先 `inspect_project` 再选测试优先的至多 3 个命令顺序执行，返回有界尾部输出与 passed/失败结论作为证据；全程无 shell、无特权命令）。新增测试 9 个。单测 280/280 通过（1 skip 为本机 symlink 权限）。仍待：编辑后全自动触发策略（权限/成本策略）、ValidationPlanner 修复迭代引导的更强编排。 |
| 2026-09-03 | G1 项目级任务（成果 3/指标 4 的 README/API 文档生成）落地：命令 `yisiAI.generateReadme` / `yisiAI.generateApiDocs` + `chatViewProvider.runProjectDocTask` + 纯提示词组装 `application/chat/projectDocTask.ts`（项目范围、探测摘要注入、落盘边界：不覆盖现有路径、既有文档走 replace_text 分块、可 run_validations 校准命令说明）。新增测试 5 个。单测 285/285 通过（1 skip 为本机 symlink 权限）。仍需人工 F5 验证入口与 Webview 呈现。 |
| 2026-09-03 | G6（ruyi 只读查询）落地：`application/ruyi/ruyiInspectionService.ts` + `ruyi_check` 工具（readOnly）。可用性用受控/可取消的 `ruyi --version` 探测（超时 8s，缺失时给出明确诊断而非崩溃），再经 `RuyiCliAdapter` 读已装包与 profile 计数/采样；失败降级为 note 不中断。后续仍应把 RuyiCliAdapter 迁移到带输出限量/取消的结构化 runner 上。新增测试 4 个。单测 289/289 通过（1 skip 为本机 symlink 权限）。 |
| 2026-09-03 | G5（本地设备/llama.cpp 预设向导）落地：`vscode/provider/localDevicePresets.ts`（本机 llama.cpp server / 如意香山南湖笔记本 / 如意 AIPC 三个预设：OpenAI 兼容 /v1 Base URL、建议模型、toolCalling 开启等能力开关）+ `providerSetupWizard` 在 llamaCpp 选型后插入预设选择（可跳过），仍保留连接测试/模型发现/无凭据本地端点安全步骤。IP 按设备修改，不写死。新增测试 2 个。单测 291/291 通过（1 skip 为本机 symlink 权限）。仍需人工 F5 验证向导视觉流程。 |
| 2026-09-03 | C1（symbol 上下文）落地：`application/context/symbolIndex.ts`（中性 DocumentSymbol 树 + 纯扁平化，真实总数与有界截断）+ `application/context/symbolLookupService.ts` + `list_symbols` 只读工具（工作区相对路径、词法边界校验、语言服务器无结果时如实提示）+ `vscode/symbols/vsCodeSymbolProvider.ts`（executeDocumentSymbolProvider → 中性模型，含 SymbolInformation 扁平回退）。新增测试 4 个。单测 295/295 通过（1 skip 为本机 symlink 权限）。 |
| 2026-09-03 | C2（RuyiCliAdapter 结构化执行）落地：`ruyi/ruyiCliAdapter.ts` 从裸 `child_process.spawn` 迁移到 `NodeProcessRunner`（精确 argv、输出限量、超时/取消、无 shell）；`--porcelain` JSON 行解析提取为可单测的 `parsePorcelainRecords`；spawn 失败/超时/取消归一为可读错误；install/uninstall 仍在 port 上但绝不暴露为 agent 工具。新增测试 5 个。单测 300/300 通过（1 skip 为本机 symlink 权限）。对应 docs/16 LNX-012/014（进程结果与输出限量）在 adapter 层已落地，真机 smoke 仍待 Linux 环境验收。 |
| 2026-09-03 | C3（命令输出智能摘要）落地：`application/process/outputSummary.ts`（head 4k + 省略标记 + tail 8k 的有界摘要）并接入 `run_command` 结果（`stdoutSummary`/`stderrSummary`，raw 字段保留），防止超长 build/test 输出整体塞入模型上下文；错误通常在尾部因此保留 tail。新增测试 3 个。单测 303/303 通过（1 skip 为本机 symlink 权限）。 |
| 2026-09-03 | G3 后续（Edit Journal 查看器，C4）落地：`editJournal.ts` 新增纯 `renderTextDiff`（行级 LCS 对齐的 `-/+/` 文本 diff，超大文件如实降级）；`WorkspaceEditService` 暴露 `journalSnapshot()`（含行增删计数/预览/是否可撤销/是否最近）与 `journalDiffText()`（create/rename 等无全内容条目给出诚实的说明文本）；命令 `yisiAI.showEditJournal`（QuickPick 浏览 → OutputChannel 展示差异 / 撤销最近一次）。新增测试 4 个。单测 307/307 通过（1 skip 为本机 symlink 权限）。Webview 内嵌面板仍为后续 UI 打磨项。 |
| 2026-09-03 | PDF 附件修复（扩展宿主）：`工作流.pdf` 报 “The PDF parser could not initialize correctly in the VS Code extension host.”。根因：pdfjs-dist 4.x 为 ESM-only + 动态 `import()` 自举 worker，在 Electron 扩展宿主不兼容。处理：切到 `pdfjs-dist@3.11.174` 的 CommonJS legacy 构建（`require('pdfjs-dist/legacy/build/pdf.js')`，文本 API 一致），`defaultAttachmentRegistry` 改为 CJS 惰性加载；并在 `pdfOpenErrorMessage` 里把底层真实错误摘要上浮（不再只显示笼统文案）。许可证登记同步（Apache-2.0）。Node(CJS) 冒烟：正常打开 13 页。单测 307/307 通过。若该 PDF 本身为无文本层扫描件，仍需用户注意“扫描件 OCR 未实现”属预期提示。 |
| 2026-09-03 | 扫描/图片型 PDF → 视觉模型（PDF 页图附件）落地：新增 `infrastructure/attachment/pdfImageEncoding.ts`（纯 JS PNG 编码 + 最近邻缩放，仅用 Node 内置 `zlib`）；`PdfExtractor` 在 `options.imagesForVision` 时经 pdf.js `getOperatorList`/对象存储抽取页内嵌栅格（无 canvas 渲染），按上限输出 `images` PNG 载荷；`AttachmentService` 以双层视觉门控决策（模型支持 + 传输支持），通过时把页图放入上下文（并移除误导性的“扫描/OCR 不支持”文案），不可用时丢弃图片并提示切视觉模型；`chatService` 支持多图内容组装。新增测试 5 个；真实合同扫描 PDF 端到端产出 4 页 PNG（1063×1503）验证通过。单测 312/312 通过（1 skip 为本机 symlink 权限）。 |
| 2026-09-03 | 页图上限可配（默认整份文档）落地：新设置 `yisiAI.pdfVisionMaxPages`（默认 0 = 整份文档；提取器内 250 页硬上限兜底），逐附件经 `AttachmentServiceOptions.getPdfVisionPagesLimit` 读取并传给 `AttachmentExtractOptions.pdfVisionPages`。新增测试 1 个；合同 PDF 13 页全量转图冒烟通过（~4.2s）。单测 313/313 通过（1 skip 为本机 symlink 权限）。 |
| 2026-09-14 | **安全修复：pdfjs-dist 3.11.174 → 4.10.38（CVE-2024-4367 / GHSA-wgrm-67xf-hhpq）**。`npm audit` 报 high：`pdfjs-dist <= 4.1.392` 在 `isEvalSupported` 为默认 `true` 时，打开恶意 PDF 会执行攻击者 JS；上游 4.2.67 移除该 `eval` 路径（mozilla/pdf.js#18015）。处理：升到 4.10.38（**4.x 最新且仍兼容宿主**——5.x/6.x 声明 `engines.node >=22.13`，而 `engines.vscode ^1.95.0` 的宿主为 Electron 32 / Node 20.18.1；4.10.38 声明 `>=20`）。4.x 为 ESM-only，故 `defaultAttachmentRegistry` 的 loader 改为**真实动态 `import('…/legacy/build/pdf.mjs')`**（specifier 用 `string` 变量持有，避免 TS 降级为 `require`；已核对 `dist` 产物保留 `import()`），并复用原有两个宿主修复（`workerSrc` → `…/pdf.worker.mjs`、worker 预载到 `globalThis.pdfjsWorker`）。**推翻旧结论**：早前"4.x ESM 在扩展宿主不可用"是误判，当初失败根因是 worker 自举缺 DOM/shim，而该修复是在改用 3.x 之后才出现的、只应用到了 3.x。清理：删除 `vendor.d.ts` 中已失效的 pdfjs 环境声明。同步更新 `THIRD_PARTY_NOTICES.md`、`docs/18`、`docs/22_HANDOVER`。**新增真实依赖集成测试 `test/pdf-real-extractor.test.js`（5 个）**——此前所有 PDF 测试都用自造 fake，生产 loader 与 pdf.js 私有对象存储契约（`getOperatorList().argsArray` → `page.objs.get()` → ImageKind）**零覆盖**，这正是漏洞能长期留存的原因；新测试经生产 registry 加载真实 pdfjs，真实 PDF 文本抽取 + 真实内嵌 RGB 光栅 → PNG 校验，并守卫版本下限与宿主 Node 兼容性。证据：`npm run check` exit 0；全量 `node --test` **419 tests / 418 pass / 0 fail / 1 skip**（升级前 414，+5 为本文件所述新测试）；`npm audit` **由 3 个漏洞（2 high + 1 critical）降为 0**（pdfjs-dist 高危随升级消除，构建期 `tar` critical 随 lockfile 重解析一并消除）。**未在本机验证**：Electron 扩展宿主内的真实行为（本机为 Node 24 验证 + 静态推理），需在 VS Code 内 F5 附加真实 PDF 做最终确认。 |
| 2026-09-14 | **清理：移除已被取代的欢迎页原型 `webview/welcome-template.html` + `webview/welcome.css`**。二者是最初基线 commit `e8028a6`（2026-08-30）的静态设计稿，此后**从未被修改、也从未被任何代码引用**（全历史 `git log -S` 无命中；`src/` 无路径指向 `webview/`；`tsconfig.include` 仅 `src/**/*.ts`；`.vscodeignore` 早已排除 `webview/**`）。实际欢迎页由 `src/yisi/ui/chatViewHtml.ts` 内联生成（nonce CSP + `webview.asWebviewUri`），品牌走 AGENTS.md 要求的两层 `ruyi-primary-mask` / `ruyi-accent-mask` CSS mask。原型本身恰是现行 UI 规则**明令禁止**的形态（白底 `ruyi-logo.png` 占满宽度 = "大 Logo + 工程说明 + 两个按钮"占位页），故删除与契约方向一致，无需保留。注意 `media/ruyi-logo.png` 仍在用（扩展 `icon` 字段），`media/` 未动。 |
| 2026-09-14 | **修复（Webview UI）：删除/重命名会话不再关闭已打开的历史面板**。现象：用户在 Session history 面板里删除一条记录后面板立即退出。根因：`#historyPanel`、`#welcome`、`#conversation` 是 `main.content` 下共享同一内容区的兄弟节点，而每次 `sessionState` 刷新都会经 `renderActiveSession()` 无条件执行 `showHistory(false)`——于是**刷新（而非用户意图）决定了视图**；删除与重命名都会 `publishState()`，因此两者都触发（用户只报了删除）。处理：让 `historyPanel.hidden` 成为内容区**唯一事实来源**，`renderView()` 改为尊重它（`historyOpen` 时既不显示 welcome 也不显示 conversation）；`renderActiveSession()` 不再关闭面板；把"关闭面板"归还给显式导航意图——选中会话行、`newChat`、home、以及 `submit()` 发送消息；`appendMessage()` 在面板打开时不再抢内容区（运行流式输出时用户可能正在看历史）。`showHistory()` 是**唯一**写 `historyPanel.hidden` 的地方。测试：`test/chat-view-source.test.js` 新增 2 个（源码不变量 + 把 `renderView`/`showHistory` 从内嵌脚本中提出、用桩元素真实驱动可见性状态机）；已用 `git show HEAD:` 的修复前源码做**假阳性检验**：15 tests / 13 pass / 2 fail，失败的正是这两个新测试，既有 13 个全过。全量 421 tests / 420 pass / 0 fail / 1 skip。**未在本机验证**：VS Code 内 F5 的真实 webview 点击（本机无 GUI 驱动能力），需人工确认删除后列表就地刷新且面板保持打开。 |
| 2026-09-14 | **新增：会话标题由 LLM 依据首次对话自动生成**。需求：历史记录里一排 "New Chat" 无法区分；默认占位名可接受，但首次对话后应由 LLM 更新名称。实现：新纯模块 `application/chat/sessionTitle.ts`（`shouldGenerateSessionTitle` / `buildSessionTitleMessages` / `parseSessionTitle`，无 provider 可测）；`SessionService.setAiTitle()` 落库为 `titleSource: 'ai'`；`ChatService.applyAutoTitle()` 在**回复已持久化且会话已 idle 之后**用同一 provider 发一次 **bare 请求**（system 指令 + 第一轮问答，无工具无历史，`temperature:0 / maxTokens:32`，流丢弃不显示），失败仅保留占位名。三条不可破坏约束：**用户改过的名字永不被覆盖**（`manual` 拒绝，覆盖"用户在请求飞行途中重命名"的真实竞态）、**只命名一次**（仅 `fallback` + 已有 provider 回复时触发）、**命名失败绝不让成功的 run 失败**（全程 try/catch）。开关 `yisiAI.sessionAutoTitle`（默认 true；每会话多一次 provider 请求）。`ChatService` 新增第 8 个参数 `options: ChatServiceOptions`，`autoTitle` **缺席即关闭**——因此既有 6 个 `new ChatService(...)` 调用点与全部既有测试语义不变，接线只在 `index.ts` 组合根（`historyBudgetRatio` 显式传 `undefined` 走默认）。测试：`test/session-title.test.js`（6）+ `test/session-auto-title.test.js`（7），含"关闭时/未接线时零额外请求""用户改名后不发请求""标题请求抛错时 run 仍成功且保留占位名""模型返回不可用内容时保留占位名"。全量 434 tests / 433 pass / 0 fail / 1 skip。UI 侧无需改动：既有 `publishState()` 会经 `sessionState` 把新标题送到顶栏与历史列表。**未在本机验证**：VS Code 内 F5 观察真实模型产出的标题质量；另观察到 `agent-loop-fix-iteration.e2e.test.js` 在全量并发下偶发失败（`replace_text` sha 竞态，真实子进程），单独跑与重跑均通过，与本改动无关（该测试不引用 `ChatService`）。 |
| 2026-09-14 | **修复（能力表）：DeepSeek 视觉/上下文窗口/内置阵容三处与官方事实不符**。触发：用户发现插件输入同一个 key 只显示 2 个模型（`deepseek-flash`、`deepseek-v4-pro`），而 DeepSeek harness 显示 4 个。**结论一：插件是对的**——官方 *Models & Pricing* 表只列 2 个当前模型，harness 额外列出的是**已退役但仍被接受**的别名（`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`，由 V4.1-Flash 承接并按 Flash 计费）。**结论二（同时纠正一次错误判断）**：先前以为"发现流程用 API 清单替换内置清单导致丢掉视觉能力"是错的因果；官方表中**`deepseek-flash` 本身就是视觉模型（DeepSeek-V4.1-Flash, Vision ✓）**。真正的 bug 在能力表：(1) `modelCapabilities` 的 deepseek 分支只认 id 里的 `vision`/`multimodal`/`vl` 标记或 `janus` 前缀，而 `deepseek-flash` **没有任何标记** → 被判为**不支持视觉**，导致图片附件/扫描件 PDF 页图被视觉门控丢弃（"cannot receive image input"）——**选对模型也发不了图**；(2) `modelContextWindow` 只认 `deepseek-v4` 前缀、兜底 64k，而 `deepseek-flash` 不以 `deepseek-v4` 开头 → 得到 **64k 而非 1M**，进而让历史压缩预算（`window × 0.6`）在约 38k token 就丢历史；(3) `providerDefaults` 列了 5 个 id、**缺 `deepseek-flash`**，只影响兜底路径（端点不可达 / "save without models"）。处理：`modelCapabilities` 加显式 `DEEPSEEK_VISION` 表（`deepseek-flash`/两个退役别名 → true，`deepseek-v4-pro`/chat/reasoner → false），并保留"显式标记优先 → 已知族继承（覆盖 `deepseek-flash-0813` 这类日期后缀）"的顺序；`modelContextWindow` 增 `deepseek-flash: 1M`；`providerDefaults` 收敛为官方当前 2 个模型。**未改动**：保留"发现结果替换内置清单"的行为（API 清单即权威），也未镜像 harness 的 4 个别名（退役 id 不作为新选项），更未新增思考模式 UI（官方称两个当前模型都支持 thinking，属缺失功能，另议）。测试：改写 `test/provider-defaults.test.js` 3 个 + `test/openai-compatible-provider.test.js` 1 个（后者同时覆盖 `imageInputTransport`，即视觉门控的另一半）；已用 `git archive HEAD` 的修复前 domain 源码编译后跑更新过的测试做**假阳性检验**：4 tests / 1 pass / **3 fail**，失败的正是三个改写项。全量 434 tests / 433 pass / 0 fail / 1 skip。**未在本机验证**：需要真实 DeepSeek key 确认 `deepseek-flash` 接受 image 输入（本机无凭据，且凭据不应交给工具搬运）。 |
| 2026-09-14 | **产品决定：模型选择器像 DeepSeek 官方 harness 一样列出"已下线但仍可调用"的旧名**。用户明确要求（承接上一条）：harness 显示 4 个（`DeepSeek-V41-Flash` / `DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` / `DeepSeek-V4-Flash-Vision-Exp`），而插件只有 2 个；官方文档也写明"旧模型名仍可调用，请求由 DeepSeek-V4.1-Flash 提供，并按 Flash 价格计费"，用户希望插件体现这一点。**这推翻了上一条里"退役 id 不作为新选项"的判断**——把它列为 UX 偏好是我判断失误：旧名既然仍可调用、且 harness 都列出来，隐藏它反而是信息缺失。处理：(1) `providerDefaults` 重构为 `KNOWN_MODELS` 显式目录，条目带 `status: 'current' | 'legacy'` 与 `servedBy`（legacy = `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` → `servedBy: 'deepseek-flash'`）；(2) 新增 `mergeDiscoveredModels(kind, discovered)`：**已知目录在前、端点额外 id 在后、去重去空白**，替换掉原先的"整体替换"；(3) `providerSetupWizard` 的 add 流程与 Refresh Models 两处调用点改为合并；(4) `ModelControlModelView` 新增 `legacyOf`，`modelControlService` 按 `configuration.kind` 查目录填充（模型命名知识仍在 domain，Webview 只做呈现）；(5) `modelControlHtml` 给旧名渲染"旧名"徽标 + tooltip 说明路由，避免把旧名静默当成当前模型展示。附带收益：端点返回 0 个模型时不再弹手动录入，而是回落到已知目录。**未改动**：手动录入（`enterModelsManually`）仍是权威（用户显式输入即照单全收）；未新增思考模式 UI（另议）。测试：`test/provider-defaults.test.js` 重写并新增合并/目录断言 + 向导与弹层的**源码级守卫**（向导 import vscode 无法直接 require）；`test/model-control-service.test.js` 新增 1 个（4 个 id 都在 + `legacyOf` 正确）。假阳性检验：`git archive HEAD` 取修复前源码（向导 + 弹层 + domain）编译后跑更新过的测试：**6 tests / 2 pass / 4 fail**，失败含"向导必须合并"这条守卫。全量 437 tests / 436 pass / 0 fail / 1 skip。**未在本机验证**：VS Code 内 F5 实际弹出的 4 条目与"旧名"徽标外观。 |
| 2026-09-14 | **补漏：上一个 commit 只改了写入路径，已保存的配置看不到旧名**。用户反馈选择器**仍然只有 2 条**。根因是我自己的疏漏：`providerSetupWizard` 的合并只作用于**新建 provider 与 Refresh Models**，而 `ModelControlService` 是原样读 `configuration.models`（已持久化），所以**老配置永远停在 2 条**，重建扩展也不会变。处理：在 `ProviderConfigurationService` 新增 `offeredModels(configuration) = mergeDiscoveredModels(kind, stored)`，**读时合并**；`ModelControlService.getState()` 的模型列表、`current.available` 判定、以及 `isAvailable()`（决定会话选择是否有效）三处全部改走该入口——只改显示不改可用性判定的话，旧名会出现但选了会被判为不可用。**刻意不改写用户已保存的配置**：读时合并意味着数据不被静默改写，代价是每次读取多一次纯函数调用。测试：`test/model-control-service.test.js` 新增 1 个用例直接复现用户状态——存储 `['deepseek-flash','deepseek-v4-pro']` → `getState()` 得到 4 条（后两条带 `legacyOf`）、`configurations.get()` 仍返回存储的 2 条（证明未改写）、把会话模型设为 `deepseek-v4-flash` 后 `current.available === true`（证明旧名真能选）。全量 438 tests / 437 pass / 0 fail / 1 skip。**未在本机验证**：需用户在 VS Code 重载扩展后确认列表变 4 条。 |

> 备注：合同 PDF 为扫描件无文本层，插件当前 PDF 附件提取器会如实给出"无文本/疑似扫描"警告（OCR 能力在插件路线图之外）；本文档分析用的是 pdftoppm 渲染 + RapidOCR 的离线提取结果。
