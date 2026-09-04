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

> 备注：合同 PDF 为扫描件无文本层，插件当前 PDF 附件提取器会如实给出"无文本/疑似扫描"警告（OCR 能力在插件路线图之外）；本文档分析用的是 pdftoppm 渲染 + RapidOCR 的离线提取结果。
