# Read-Only Agent Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded provider-to-tool-to-provider loop for Yisi's existing read-only workspace tools.

**Architecture:** Add host-neutral agent stream contracts beside the current chat contracts. The OpenAI-compatible adapter normalizes fragmented wire events; an application loop validates tool identity, delegates input validation to registered tools, evaluates every call with PermissionEngine, and returns bounded tool messages until final text or a guard stops the run.

**Tech Stack:** TypeScript 5.7, Fetch/SSE, Node built-in test runner, existing Yisi ports, no new dependency.

## Global Constraints

- First-party production code remains TypeScript/JavaScript.
- Domain/application code must not import `vscode`, provider SDKs, filesystem adapters, or OpenAI wire types.
- Tool calls use the existing Extension Host `YisiTool.execute` boundary and PermissionEngine; the Webview receives no privileged access.
- This plan exposes only read-only workspace tools and never treats confirmation as approval.
- Provider inputs, arguments, results, errors, rounds, and call counts are bounded.
- Existing text-only chat behavior remains compatible.
- Every code task follows RED → GREEN, fresh full verification, and a focused commit.

---

### Task 1: Agent stream domain contracts

**Files:**
- Modify: `src/yisi/llm/types.ts`
- Test: `test/agent-types.test.js`

**Interfaces:**
- Produces `AgentToolDefinition`, `AgentToolCall`, `AgentStreamEvent`, `AgentConversationMessage`, `AgentRequest`, and optional `LLMProvider.streamAgent(request, signal)`.
- `AgentStreamEvent` is `{ type: 'textDelta'; text: string } | { type: 'toolCall'; call: AgentToolCall }`.

- [x] **Step 1: Write the failing runtime guard tests** for exact tool definition/message/event shapes and rejection of blank ids/names or non-object input through exported parse helpers.
- [x] **Step 2: Run RED:** `npm run compile && node --test test/agent-types.test.js`; expect missing exports.
- [x] **Step 3: Implement contracts and parsers** with trimmed non-empty identifiers, JSON-object input, and exact discriminants; keep `streamAgent` optional so existing provider fakes and ChatService remain compatible.
- [x] **Step 4: Run GREEN:** focused test, `npm test`, and `npm run check`; expect zero failures.
- [x] **Step 5: Commit:** `feat: define agent tool stream contracts`.

### Task 2: OpenAI-compatible tool stream normalization

**Files:**
- Modify: `src/yisi/infrastructure/llm/openAICompatibleProvider.ts`
- Modify: `test/openai-compatible-provider.test.js`

**Interfaces:**
- Consumes `AgentRequest` and emits `AgentStreamEvent`.
- Sends `{model,messages,tools,tool_choice:'auto',stream:true}` with tool definitions mapped to Chat Completions function tools.
- Accumulates calls by numeric index, max 16 calls and 65,536 argument bytes per call.

- [ ] **Step 1: Write failing tests** for request mapping, fragmented name/argument events, multiple calls, final text, malformed JSON, missing call id/name, mixed text/tool completion, count limit, and argument limit.
- [ ] **Step 2: Run RED:** focused provider test; expect `streamAgent is not a function`.
- [ ] **Step 3: Implement `streamAgent`** using the existing SSE parser and transport error normalization. Parse only JSON objects and emit calls only on a `tool_calls` finish reason.
- [ ] **Step 4: Run GREEN:** focused/full tests and typecheck.
- [ ] **Step 5: Commit:** `feat: normalize compatible provider tool calls`.

### Task 3: Registry, result bounds, and read-only loop

**Files:**
- Create: `src/yisi/application/agent/toolRegistry.ts`
- Create: `src/yisi/application/agent/readOnlyAgentLoop.ts`
- Test: `test/read-only-agent-loop.test.js`

**Interfaces:**
- `ToolRegistry` rejects duplicate ids and exposes schemas plus exact lookup.
- `ReadOnlyAgentLoop.run(request, context, mode, onDelta, signal): Promise<AgentLoopResult>`.
- Defaults: 8 provider rounds, 16 calls/round, 65,536 serialized result characters, 240 error characters.

- [ ] **Step 1: Write failing tests** for read→result→final flow, multiple sequential calls, unknown tool, permission deny/confirm, inconsistent metadata, invalid input, bounded error/result, cancellation, duplicate consecutive call, empty output, and round budget.
- [ ] **Step 2: Run RED:** compile and focused test; expect missing loop module.
- [ ] **Step 3: Implement the registry** with exact ids and cloned public definitions.
- [ ] **Step 4: Implement the loop**: stream one round, buffer text, reject ambiguous mixed output, permission-check every call, execute sequentially with the caller signal, append structural assistant/tool messages, and enforce guards.
- [ ] **Step 5: Run GREEN:** focused/full tests, typecheck, and diff check.
- [ ] **Step 6: Commit:** `feat: execute bounded read-only agent loop`.

### Task 4: Documentation and integration

**Files:**
- Modify: `README.md`
- Modify: `docs/12_ROADMAP_AND_DOD.md`

**Interfaces:**
- Records the tested loop as an application capability, not a user-visible completion claim.
- Extension Host and Session/UI wiring remains the next vertical slice because provider capability opt-in does not exist yet; no unused object is added to `registerYisiAI`.

- [ ] **Step 1: Document exact delivered behavior** and explicitly record that provider capability plus Session/UI opt-in is the next slice, not completed here.
- [ ] **Step 2: Run fresh** `npm test`, `npm run check`, `npm run compile`, `git diff --check`, and inspect `git status --short`.
- [ ] **Step 3: Commit, fast-forward merge to `main`, rerun tests, delete the branch, and continue provider capability plus Session/UI wiring.**
