# Agent Chat Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route explicitly tool-capable provider turns from the existing Composer through the bounded read-only Agent loop.

**Architecture:** Persist an explicit provider capability with v1→v2 migration, expose it through the provider port, adapt ReadOnlyAgentLoop behind `AgentConversationRunner`, and inject a runner only for one local workspace. ChatService owns selection and persistence.

**Tech Stack:** TypeScript 5.7, VS Code API, existing Fetch/SSE and Node tests, no new dependency.

## Global Constraints

- Existing provider configurations migrate to tool calling disabled.
- No secret enters provider metadata, Session messages, logs, or Webview state.
- Capability enabled never silently degrades to text chat.
- Only the existing read-only tools are registered; write/process tools remain out of scope.
- Zero/multi-root/non-file workspaces keep text chat but cannot run Agent tools.
- Every implementation task follows RED → GREEN and fresh verification.

---

### Task 1: Provider capability schema v2

**Files:** `src/yisi/domain/providerConfiguration.ts`, `test/provider-configuration.test.js`, `test/provider-catalog.test.js`

- [x] Add failing tests for v1 migration to disabled, exact v2 capability parsing, create/persist cloning, and secret-looking/unknown capability rejection.
- [x] Run focused RED and confirm schema/capability failures.
- [x] Implement schema v2 plus v1 migration; update test inputs and factory behavior without changing credential storage.
- [x] Run full tests/typecheck and commit `feat: persist provider tool capability`.

### Task 2: Provider reporting and AgentChatRunner

**Files:** `src/yisi/infrastructure/llm/openAICompatibleProvider.ts`, `src/yisi/application/agent/agentChatRunner.ts`, `test/openai-compatible-provider.test.js`, `test/agent-chat-runner.test.js`

- [ ] Add failing tests for capability reporting, missing `streamAgent`, loop completion, blocked reason, and cancellation forwarding.
- [ ] Run focused RED.
- [ ] Pass capability through provider options and implement the runner as a narrow wrapper around ReadOnlyAgentLoop.
- [ ] Run full tests/typecheck and commit `feat: adapt agent loop to chat turns`.

### Task 3: ChatService routing and persistence

**Files:** `src/yisi/application/chat/chatService.ts`, `test/chat-service.test.js`

- [ ] Add failing tests proving disabled→streamChat, enabled→Agent runner, final response persistence, missing runner failure, loop block, and cancellation status.
- [ ] Run focused RED.
- [ ] Implement per-turn capability selection while preserving one durable user message and one final assistant message.
- [ ] Run full tests/typecheck and commit `feat: route capable chat turns through agent`.

### Task 4: Wizard and Extension Host composition

**Files:** `src/yisi/vscode/provider/providerSetupWizard.ts`, `src/yisi/index.ts`, `src/yisi/vscode/context/localAgentWorkspace.ts`, `test/local-agent-workspace.test.js`, `README.md`, `docs/12_ROADMAP_AND_DOD.md`

- [ ] Add failing pure tests for exactly-one-local-workspace eligibility.
- [ ] Implement the predicate and compose Node workspace tools/runner only when eligible.
- [ ] Add the explicit wizard capability choice and pass it into provider creation.
- [ ] Document delivered behavior and remaining write/confirmation gap.
- [ ] Run fresh full tests/check/compile/diff review, commit, merge main, rerun, delete branch, and continue controlled editing.
