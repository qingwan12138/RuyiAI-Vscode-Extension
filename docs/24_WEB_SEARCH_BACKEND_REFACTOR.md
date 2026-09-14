# 24 — 联网搜索：改用「模型端点自带的搜索」后端（重构说明）

- **日期**：2026-09-14 · **状态**：已实现，待真机验收
- **决定**：`docs/decisions/ADR-0014-native-web-search-backend.md`
- **前置**：`docs/23_WEB_SEARCH_IMPLEMENTATION_REPORT.md`（MCP 服务器与 SearXNG 后端）
- 当前的测试数请以 `docs/18_COMPATIBILITY_MATRIX.md` 为准。

---

## 1. 一句话结论

**你不需要把 provider 改成 Anthropic——改成 Anthropic 反而会让 agent 残废。**

正确做法是把「Anthropic 格式端点 + 服务端搜索工具」当成**搜索后端**，接到已经做好的 websearch MCP 服务器上。改动只有一个新模块 + 一个后端选择函数，**不碰** agent 循环、不碰 provider、不碰权限模型。

---

## 2. 为什么原计划（"改成 Anthropic"）是错的

这是本次重构最重要的发现，必须先讲清楚，因为它会**静默毁掉整个产品**：

`src/yisi/infrastructure/llm/anthropicProvider.ts` 的 `AnthropicProvider`：

```ts
async capabilities(model: string): Promise<ModelCapabilities> {
  return {
    toolCalling: false,        // ← 关键
    streaming: true,
    vision: modelSupportsVision('anthropic', model, this.options.vision),
    reasoning: this.options.thinking ?? false,
    structuredOutput: false
  };
}
```

Yisi 的 agent 路径要求 provider 具备**结构化工具流**（有一条测试专门锁这一点："rejects providers without structural tool streaming"）。`AnthropicProvider` 目前**只做文本/视觉流式**，不支持 `tool_use` / `tool_result`。

所以把聊天 provider 换成它，后果是：

- agent 路径不可用 → **所有内置工具（读文件、改文件、跑命令、Ruyi、git、子代理…）全部消失**；
- Yisi 从 Coding Agent 退化成一个**聊天框**——正是 `AGENTS.md §2` 第一条明令禁止的形态。

**而且这跟联网完全无关**：服务端搜索只是"一个说 Messages 协议的 HTTP 端点 + 一个服务端工具"，它**不需要**承载 agent 的对话。

---

## 3. 新方案：native 搜索后端

### 3.1 机制

模型端点（DeepSeek / Anthropic）把联网做成 **Messages API 上的服务端工具**：

```
POST {baseUrl}/v1/messages
{
  "model": "deepseek-flash",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "<查询词>" }],
  "tools": [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 1 }]
}
```

**搜索在服务商自己的基础设施上执行**，结果以结构化块返回：

- `web_search_tool_result` → 内含 `web_search_result` 列表（`url` / `title` / `page_age`）；
- 文本块里的 `citations[].cited_text` → 按 URL 关联成摘要（snippet）。

于是：**没有搜索供应商、没有第二个账号、没有 SearXNG、没有 API key 之外的东西。**

### 3.2 两条刻意的设计约束

1. **只信结构化块，丢弃服务商自己写的正文。** 那段正文是"总结"，不是来源；把它当答案，搜索结果就退化成一句无法核实的断言。有测试断言它**绝不会**变成结果条目。
2. **没有搜索块 = 报错，不是空结果。** "端点其实没搜"和"网上什么都没有"必须长得不一样。有测试分别覆盖。

### 3.3 为什么它是 `SearchBackend`，而不是一个"服务端工具"

这是本次设计里最关键的一步。服务端搜索如果发生在**一次普通对话回合的内部**，那么：

- 它**不会**经过 `PermissionEngine`；
- **Plan 模式拦不住它**；
- **审批卡片永远不会出现**——模型直接搜了，用户毫不知情。

把它做成 `SearchBackend`，搜索就仍然是**一次客户端工具调用**（`mcp__websearch__web_search`），于是 `network` 轴、Plan 拒绝、逐次审批、hooks、失败降级**全部照旧生效**。功能是新的，闸门一个没少。

---

## 4. 后端选择（优先级表）

读环境变量（MCP 条目刻意不支持 `env`，所以配置只能来自环境）：

| 优先级 | 条件 | 结果 |
|---|---|---|
| 1 | `YISI_SEARCH_BACKEND=none` | 显式关闭搜索（`web_fetch` 仍可用） |
| 1 | `YISI_SEARCH_BACKEND=searxng` | SearXNG，**必须**同时有 `YISI_SEARXNG_URL`，否则报错而非静默 |
| 1 | `YISI_SEARCH_BACKEND=native` | 服务端搜索，**必须**有 key |
| 2 | `YISI_SEARXNG_URL` 存在 | SearXNG（用户明确指定了实例） |
| 3 | 有 `YISI_SEARCH_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | **native（零配置路径）** |
| — | 都没有 | 如实报告"没有后端"，并同时给出两条路 |

原则是**显式胜过隐式**：用户明确给了 SearXNG 地址，就用 SearXNG；只有"什么都没说、但环境里恰好有模型 key"时才走 native。

| 变量 | 默认 | 说明 |
|---|---|---|
| `YISI_SEARCH_BACKEND` | `auto` | `auto` / `searxng` / `native` / `none` |
| `YISI_SEARCH_BASE_URL` | `https://api.deepseek.com/anthropic` | Anthropic 兼容端点（`.../anthropic` 或 `.../anthropic/v1` 都认） |
| `YISI_SEARCH_MODEL` | `deepseek-flash` | 只用于这次搜索请求 |
| `YISI_SEARCH_TOOL` | `web_search_20250305` | 端点的服务端工具类型 |
| `YISI_SEARCH_API_KEY` | 回落到 `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | **只从环境读** |

---

## 5. 代价与边界（如实）

- **不是免费，但不是新账单**：一次搜索 = **一次模型调用**的 token 与延迟，烧的是你已有的 DeepSeek 额度。SearXNG 那条路才是完全不花钱。
- **模型 id 会漂**：默认 `deepseek-flash` 是当前阵容里的 id（`deepseek-v4-flash` 已退役）。端点不认这个 id 时会返回 400，错误信息里直接写出该改哪个变量——**绝不让它静默失败**。
- **端点的服务端搜索能力无法在开发机验证**：需要真 key。所以我提供了探针（§7）。
- **key 只能来自环境**。你的 key 现在存在 VS Code `SecretStorage` 里，**不会自动出现在扩展宿主的环境里**。这意味着要走 native 后端，你需要把 key 导出到环境（见 §6）。这是刻意的：`AGENTS.md` 的 MCP rule 要求"秘密只进用户的 shell/环境"，而把 SecretStorage 的值注入子进程是一个**新的秘密流向**，该由它自己的 ADR 决定，不该顺手做掉。
- **key 不进日志**：只打印前 4 位、末 2 位与长度；端点返回的错误里若出现完整 key，会被替换成 `[REDACTED]`；有测试锁这两条。

---

## 6. 你要做的（三步，只做一次）

1. **provider 保持不动**（继续用你现在能跑 agent 的那个，OpenAI 兼容通道）。**不要**切到 Anthropic。
2. **把 key 放进环境**，然后**从该环境启动 VS Code**：

   ```bash
   # Linux 本机（推荐写进 ~/.profile 或 shell 启动文件，然后从终端启动 code）
   export DEEPSEEK_API_KEY=sk-...
   code .
   ```

3. **先跑探针确认端点真的支持服务端搜索**（见 §7）。通了就不需要再做任何配置——`web_search` 会自动用它。

如果探针里换过模型，把结论固定下来：

```bash
export YISI_SEARCH_MODEL=deepseek-v4-pro   # 用探针里成功的那个
```

**完全不想用 native 也可以**：设 `YISI_SEARCH_BACKEND=searxng` + `YISI_SEARXNG_URL` 就走自建 SearXNG（完全不花钱）；或者什么都不设，`web_fetch` 依然可用。

---

## 7. 一条命令验证（这是你要跑的那条）

```bash
npm run websearch:probe -- "ruyisdk latest release"
# 等价于：npm run compile && node scripts/probe-native-search.js "查询词"
```

它会：打印真实端点与工具类型 → 按候选模型逐个试 → **成功就打印真实搜索结果**，失败就**原样打印服务商自己的错误**。退出码 0 = 真的搜到了；1 = 没搜到；2 = 没给 key。

**已经用它验证到的**（本机、假 key、真实端点）：

```
endpoint : https://api.deepseek.com/anthropic/v1/messages
trying model deepseek-flash ... failed
  The search endpoint ... returned HTTP 401: {"error":{"message":"Authentication Fails, Your api key: ****heck is invalid", ...}}
```

这条 401 是有价值的证据：**请求形状被端点接受了**（URL、`anthropic-version`、`x-api-key`、JSON body 全部解析通过），只卡在鉴权。也就是说协议这一层是对的，剩下唯一未知的是"你的 key 能否触发搜索"——那只能由你用真 key 跑一次探针。

---

## 8. 改了哪些文件

| 文件 | 变更 |
|---|---|
| `src/yisi/mcp-server/websearch/nativeSearchBackend.ts` | **新增**：native 后端 + 结构化块解析 + 端点规范化 + 密钥脱敏 |
| `src/yisi/mcp-server/websearch/server.ts` | **新增** `resolveSearchBackend()`（优先级逻辑集中在一处，可评审）；`main()` 用它的结论，并把非机密说明写 stderr |
| `src/yisi/mcp-server/websearch/webTools.ts` | "没有后端"的错误文案同时给出两条路 |
| `scripts/probe-native-search.js` | **新增**：一条命令的真实验证探针 |
| `package.json` | 新增 `websearch:probe` 脚本 |
| `test/websearch-native-backend.test.js` | **新增 14 个用例** |
| `docs/decisions/ADR-0014-*.md`、`docs/20`、`docs/12`、`docs/18`、`docs/22`、`AGENTS.md` | 决定与文档同步 |

**没有改**：`AnthropicProvider`、agent 循环、`PermissionEngine`、MCP 客户端/传输/配置解析器、任何 provider 配置。所以这次重构**不可能**影响现有 agent 行为。

---

## 9. 回滚

设 `YISI_SEARCH_BACKEND=searxng`（或 `none`）即可立刻停用 native 后端，**不需要改代码、不需要降级版本**。native 后端不与任何既有路径共享状态。

---

## 10. 明确未做

- **不把 SecretStorage 的 key 注入子进程**（见 §5，需要独立 ADR）。
- **不做"服务端搜索直接进对话"**：那会绕过 `network` 闸门（§3.3）。
- **未在真机验证**：真 key + 真搜索 + 真 VS Code 里的审批卡片。
- 未做：搜索结果缓存、按 host 粒度的网络授权、`web_search` 的结果条数在 native 后端下的服务端裁剪（`max_uses` 是搜索**次数**，不是结果条数）。
