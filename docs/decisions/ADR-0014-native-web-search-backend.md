# ADR-0014 — 联网搜索的第二种后端：模型端点自带的服务端搜索

## Status
Accepted（2026-09-14）

## Context

ADR-0013 把联网做成内置 MCP 服务器，后端是用户自建的 SearXNG。它满足"不花钱"，但有一个真实摩擦：**用户必须先跑一个 SearXNG**。

后来发现（`docs/14` 早已记过该机制）DeepSeek 与 Anthropic 把联网做成 **Messages API 上的服务端工具** `web_search_20250305`：请求里声明它，搜索在**服务商自己的基础设施**上执行，结果以结构化块返回。用户已有的模型 key 就够了 —— 没有搜索供应商、没有第二个账号。

但一个更重要的发现决定了本 ADR 的形状：**当时拟定的做法是"把 provider 改成 Anthropic"，而那是错的**。`AnthropicProvider` 的 `capabilities()` 返回 `toolCalling: false`，而 agent 路径要求结构化工具流（有测试锁定）。切过去会让 agent 失去**全部**工具，把产品退化成聊天框 —— 正是 `AGENTS.md §2` 禁止的形态。而且服务端搜索**不需要**承载对话，它只需要一个说 Messages 协议的 HTTP 端点。

## Decision

**新增 native 搜索后端，作为既有 websearch MCP 服务器的第二个 `SearchBackend`；不改 provider、不改 agent 循环、不改权限模型。**

```
web_search（客户端工具，逐次过 PermissionEngine）
   └─ SearchBackend
        ├─ searxng  → 用户自建 SearXNG（不花钱，需自建）
        └─ native   → 模型端点的服务端搜索（零配置，烧已有额度）
```

### 三条不可动摇的规则

1. **它必须是 `SearchBackend`，不能是"对话里的服务端工具"。**
   服务端搜索若发生在一次普通对话回合内部，就**不会**经过 `PermissionEngine`：**Plan 模式拦不住、审批卡片不出现、用户毫不知情**。做成 `SearchBackend` 后，搜索仍然是**一次客户端工具调用**，因此 `network` 轴、Plan 拒绝、逐次审批、hooks、失败降级**全部照旧**。功能是新的，闸门一个没少 —— 这是本 ADR 的核心。

2. **只信结构化块，丢弃服务商正文。** 结果只来自 `web_search_tool_result` 里的 `web_search_result` 条目；摘要来自按 URL 关联的 `cited_text`。服务商自己写的那段总结是**总结，不是来源**，把它当答案会让搜索结果退化成无法核实的断言。

3. **没有搜索块 = 报错，不是空结果。** "端点其实没搜"与"网上什么都没有"必须可区分，否则用户会把一次失败当成一次成功的空搜索。

### 后端选择（优先级：显式胜过隐式）

| 优先级 | 条件 | 结果 |
|---|---|---|
| 1 | `YISI_SEARCH_BACKEND` = `none` / `searxng` / `native` | 用户的明确选择；缺少配套变量时**报错，不静默回落** |
| 2 | `YISI_SEARXNG_URL` | SearXNG（用户明确指定了实例） |
| 3 | `YISI_SEARCH_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | **native（零配置路径）** |
| — | 都没有 | 如实报告没有后端，并同时给出两条路 |

`YISI_SEARCH_BASE_URL`（默认 `https://api.deepseek.com/anthropic`）、`YISI_SEARCH_MODEL`（默认 `deepseek-flash`）、`YISI_SEARCH_TOOL`（默认 `web_search_20250305`）都可覆盖 —— **因为模型 id 与工具类型都会漂，硬编码的猜测绝不允许变成静默失败**。

## Consequences

- 新增 `nativeSearchBackend.ts` 与 `resolveSearchBackend()`；`web_search` 的失败文案同时给出两条路；新增探针 `scripts/probe-native-search.js`（`npm run websearch:probe`）。
- **未改动**：`AnthropicProvider`、agent 循环、`PermissionEngine`、MCP 客户端/传输/配置解析器、provider 配置。因此本次重构**不可能**影响既有 agent 行为。
- **成本如实**：native 一次搜索 = **一次模型调用**的 token 与延迟（烧用户已有额度）。**不是免费**，也不是新账单。SearXNG 那条路才完全不花钱。
- **key 只从环境读**。用户的 key 在 `SecretStorage` 里，**不会**自动出现在扩展宿主环境中；走 native 需要用户把 key 导出到环境。**刻意不把 SecretStorage 的值注入子进程**：那是一条**新的秘密流向**，与 `AGENTS.md` 的 MCP rule（"秘密只进用户的 shell/环境"）相抵触，应由它自己的 ADR 决定。`StdioMcpTransport` 虽已支持 `env`，本 ADR 不使用它。
- **回滚零成本**：`YISI_SEARCH_BACKEND=searxng`（或 `none`）即刻停用 native，不需要改代码或降级版本。
- **未在本机验证**：端点的服务端搜索能力需要真 key。已用**真实端点 + 假 key** 验证到 **HTTP 401** —— 证明请求形状（URL、`anthropic-version`、`x-api-key`、JSON body）被端点接受、只卡在鉴权。真 key 的检验由探针完成（退出码 0/1/2）。
- **未做**：把搜索做成"对话内服务端工具"（会绕过闸门，规则 1）、结果缓存、按 host 的授权粒度、native 后端下的服务端结果条数裁剪（`max_uses` 是搜索**次数**，不是结果条数）。

## 守卫
`test/websearch-native-backend.test.js`（14：请求形状只声明服务端工具、结果只来自结构化块且正文被丢弃、多搜索的重复 URL 去重、无搜索块报错、服务商错误码透出、HTTP 失败点名端点且**密钥被脱敏**、非 JSON 与取消区分、端点两种写法归一、**后端选择优先级与显式关闭**、模型/工具类型可覆盖）。既有 `test/websearch-mcp.test.js`、`test/websearch-url-policy.test.js` 不变。
