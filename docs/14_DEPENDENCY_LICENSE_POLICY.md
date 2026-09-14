# 14 — Dependency / License Policy for Closed-Source Delivery

## 默认政策
- 优先 VS Code/Node 标准能力和成熟、窄职责依赖。
- 新增 runtime dependency 必须说明：用途、替代方案、license、维护状态、bundle 影响、Remote SSH/native 风险。
- Apache-2.0/MIT/BSD 等通常可评估使用，但必须履行 attribution/NOTICE 等义务；不是“随便复制源码”。
- GPL/AGPL/SSPL/未知/自定义限制许可证默认禁止进入 runtime/bundle，除非项目负责人/甲方/法务批准。
- devDependency 同样登记，但交付义务按实际分发内容审计。

## 参考项目与依赖不同
Cline/Codex/Aider 等可以是“研究参考”，不等于 npm/cargo dependency。不要因为其开源就把其内部 package 直接 vendoring。

## 交付文件
维护：
- `THIRD_PARTY_NOTICES.md`
- dependency lockfile
- license scan report
- SBOM（RC 阶段建议生成）

## 禁止
- 从 GitHub 复制一个文件后删版权头。
- 把参考项目 prompt/测试快照/图标/字体/品牌资源搬进闭源项目。
- 使用来源不清晰的代码片段。

## 联网能力的供应商评估（研究已记录；**未实施、未写代码、决策待定**）

2026-09-14 针对"给 Agent 加联网查询"做了方案研究（含 DeepSeek / 各家搜索 API / Codex 网络策略）。**结论是暂时不要动手**，理由如下，全部为文档化事实：

### 模型侧
- **DeepSeek 没有独立搜索端点。** OpenAI 格式的 Responses API 明确 **忽略** `web_search`（Tools 表："other built-in tools — Ignored"），Chat Completions 只有客户端 function calling。只有 **Anthropic 格式端点** `https://api.deepseek.com/anthropic` 支持 `server_tool_use` / `web_search_tool_result` 内容块。
- Harness 的 `web-search-deepseek` 明确写"**DeepSeek exposes no dedicated search endpoint**"，且**一次搜索 = 一整轮 Messages 模型调用**；无结果数旋钮（`maxResults` 只能事后裁剪）；响应中没有 `web_search_tool_result` 块时**抛错而非降级**。
- **任何地方都没有文档化"每次搜索多少钱"** → 只能按"每搜一次 = 一次 flash 轮次"的 token 价估算。
- 影响：若走这条路，DeepSeek 需要**第二条传输路径**（Anthropic 格式）。Yisi 已有 `AnthropicProvider`，但 deepseek 目前走 OpenAI 兼容通道 —— 这是架构级改动，不是加个工具。

### 供应商（未实施，仅登记约束）
| 供应商 | 文档化结论 |
|---|---|
| Bing Search API | **2025-08-11 已退役**；替代品（Grounding with Bing）**不把工具输出返回给开发者**，禁止缓存/训练/转售 → 对"要把结果交给模型的 Agent"不可用 |
| Google CSE | **已停止接纳新客户**，2027-01-01 日落 → 不可用 |
| Brave | ToS 禁止超出"transient"的存储、禁止转售/再许可、禁止用于 benchmark 或训练，且要求把同等义务**约束到你的终端用户** → **与带缓存的 Agent 很可能不兼容** |
| Tavily | §6.5 是这一批里**唯一声称可训练你的输入输出**的条款（§3.2 允许集成进客户应用）→ 须法务判断 |
| Serper | 端点/鉴权/定价**均未能核实**；ToS 自述为 web-scraped 数据、与 Google 无关联 |
| Bocha | 定价需登录飞书（**未核实**）；§3.2 有"任何其他用途须事先书面同意"的兜底且无商业例外；另有内容审核义务 → 须法务判断 |
| Exa | **ToS 是一份无法解码的 PDF → 状态是"未评估"，不是"已通过"**，不得因其定价清晰而视作可采购 |
| **Zhipu / BigModel** | **中国侧文档最完整**：独立端点（`POST https://open.bigmodel.cn/api/paas/v4/web_search`，Bearer 鉴权）+ 文档化人民币单价（`search_std` 0.01 元/次、`search_pro` 0.03、`search_pro_sogou`/`search_pro_quark` 0.05）+ 声明"您完全拥有您的数据"且**未主张训练权**。**代价落在集成方**：§3.3/§3.6 要求遵守《生成式人工智能服务管理暂行办法》等并自行承担**算法备案、安全评估、上线备案** → 这是**产品/法务决定**，不是工程决定 |

### 设计约束（供将来决策，不是现在实施）
- **`network` 是新的轴，不是 workspace-write 的同级风险**：Harness 的 `SandboxMode` 明确"只治理文件效果，网络与进程可见性**不在其词汇内**"。Yisi 的 loop 当前按设计拒绝 `network`（有测试锁定）——要开就是**新增一根轴**，需要单独的安全论证。
- **审批先例并不存在**：只有 Claude Code 会为网页访问弹审批（且按 **repo + domain** 持久）；Harness 文档明说"**Public fetches do not request approval**"，在**所有**沙箱与审批模式下都如此，且"文件沙箱预设不治理 Web 网络访问"；Codex 的 web search 未见审批文档（只由设置与托管白名单控制）。所以要照搬"每模式审批"没有依据，得自己论证。
- 抓取工具的文档化上限（参考 `dsh-web-fetch-http`）：`maxResponseBytes` 5MB、`maxBodyChars` 100k、`timeoutMs` 30s、`maxRedirects` 5 **仅同源**、URL ≤ 2048、仅 `http`/`https`、禁止 URL 内嵌凭据、**域名解析一次、任一解析结果非公网单播即整体拒绝、并把连接钉在已校验的地址集上**、跨源重定向**失败**、缺失或二进制 `Content-Type` 抛错。Codex 则明确**不做 pinning**，并在文档中说明彻底防 rebinding 需要更底层的出口管控。
- **残余风险的诚实记录**：SSRF 检查"**并不能阻止模型把数据发往某个公网 URL**"；且**没有任何供应商文档化中国大陆可达性**——可达性是"要测的属性"，不是"文档化的保证"。

> 研究过程中一个有意思的方法论旁证：研究子代理抓取 Brave 的 API 域名时被**它自己的 SSRF 防护**以"resolves to a non-public IP address"拒绝——将来实现同类防护时会遇到同样的误判。本节的详细研究报告（614 行 + Codex 专题）按 clean-room 规则**未保留在仓库**，要点如上。
