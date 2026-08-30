# Provider Configuration and Streaming Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure secure OpenAI/OpenAI-compatible providers and run a cancellable, streamed, persisted chat turn from the Yisi composer.

**Architecture:** VS Code adapters persist ordinary provider metadata and secrets through separate ports. `ChatService` consumes a provider catalog and `SessionService`; `OpenAICompatibleProvider` uses native fetch and an isolated SSE parser, while the Webview receives only sanitized stream events.

**Tech Stack:** TypeScript 5.7, Node.js fetch/streams/HTTP test server, VS Code API, Node built-in test runner, vanilla Webview JavaScript.

## Global Constraints

- Milestone is v0.1 Foundation / Chat Vertical Slice.
- Product code remains TypeScript/JavaScript with no new production dependency.
- Domain/application code does not import `vscode` or a concrete Provider SDK.
- Secrets never enter configuration JSON, Session JSON, Webview messages, prompts, or logs.
- OpenAI and custom OpenAI-compatible endpoints share only the conservative Chat Completions subset.
- A local compatible endpoint may use `http` and no credential; OpenAI requires `https` and a credential.
- Existing Session provider/model binding is authoritative and never silently replaced.
- Stop propagates AbortSignal and partial output is not persisted as a completed response.
- The CC-style topbar and theme-adaptive Ruyi mark remain unchanged.

---

### Task 1: Provider configuration domain, repositories, and secrets

**Files:**
- Create: `src/yisi/domain/providerConfiguration.ts`
- Create: `src/yisi/application/provider/providerConfigurationRepository.ts`
- Create: `src/yisi/application/provider/secretStore.ts`
- Create: `src/yisi/application/provider/providerConfigurationService.ts`
- Create: `test/provider-configuration.test.js`

**Interfaces:**
- Produces `ProviderConfigurationDocument`, `ProviderConfiguration`, `CredentialSource`, `parseProviderConfigurationDocument`.
- Produces `ProviderConfigurationRepository.load/save`, `SecretStore.get/set/delete`, and CRUD/default resolution methods on `ProviderConfigurationService`.

- [ ] **Step 1: Write failing tests** for schema validation, base URL normalization, OpenAI credential enforcement, CRUD, default resolution, and proof that serialized configuration never contains a secret value.

```js
test('OpenAI configuration requires a credential source', () => {
  assert.throws(() => createProviderConfiguration({
    kind: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    credential: { source: 'none' }, models: ['model-a']
  }), /credential/);
});
```

- [ ] **Step 2: Run `npm test` and confirm RED** because the provider configuration module is missing.
- [ ] **Step 3: Implement the schema and transactional service** with injected ID/clock, defensive copies, global configurations, workspace default, and opaque secret keys `yisiAI.provider.<id>.apiKey`.
- [ ] **Step 4: Run `npm test` and `npm run check`; expect zero failures.**
- [ ] **Step 5: Commit** with `git commit -m "feat: add provider configuration service"`.

### Task 2: SSE parser and OpenAI-compatible transport

**Files:**
- Modify: `src/yisi/llm/types.ts`
- Create: `src/yisi/infrastructure/llm/sseParser.ts`
- Create: `src/yisi/infrastructure/llm/openAICompatibleProvider.ts`
- Create: `test/sse-parser.test.js`
- Create: `test/openai-compatible-provider.test.js`

**Interfaces:**
- Produces `LLMProvider.streamChat(request, signal): AsyncIterable<ChatDelta>` and cancellable `listModels`.
- Produces `parseServerSentEvents(stream, signal)` yielding data payloads.

- [ ] **Step 1: Write failing parser tests** for fragmented UTF-8/line boundaries, comments, multi-line data, `[DONE]`, malformed JSON, missing body, HTTP errors, optional bearer header, and AbortSignal.

```js
test('streams deltas from arbitrarily fragmented SSE frames', async () => {
  const provider = createProviderAgainstLocalServer(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n']);
  assert.equal(await collect(provider.streamChat(request)), 'Hello');
});
```

- [ ] **Step 2: Run `npm test` and confirm RED** because the parser/adapter is missing.
- [ ] **Step 3: Implement native-fetch transport** with bounded error bodies, safe request IDs, exact URL joining, JSON runtime checks, SSE decoding, and cancellation propagation.
- [ ] **Step 4: Run `npm test` and `npm run check`; expect all transport tests to pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat: add OpenAI-compatible streaming provider"`.

### Task 3: Provider catalog and chat orchestration

**Files:**
- Create: `src/yisi/application/provider/providerCatalog.ts`
- Create: `src/yisi/application/chat/chatService.ts`
- Modify: `src/yisi/application/session/sessionService.ts`
- Create: `test/provider-catalog.test.js`
- Create: `test/chat-service.test.js`

**Interfaces:**
- Produces `ProviderCatalog.resolve(providerId): Promise<LLMProvider>` and `ChatService.send(text, onDelta, signal)`.
- Adds `SessionService.setModelSelection`, `setStatus`, and atomic `appendProviderResponse` behavior.

- [ ] **Step 1: Write failing tests** for secret/environment/no-credential resolution, unavailable bindings, excluding baseline notices from prompts, delta forwarding, successful final persistence, provider failure, concurrent-send rejection, and cancellation.

```js
test('persists only the completed provider response', async () => {
  await chat.send('hello', delta => deltas.push(delta), new AbortController().signal);
  assert.deepEqual(active().items.map(item => item.type), ['userMessage', 'assistantMessage']);
  assert.equal(active().items[1].source, 'provider');
});
```

- [ ] **Step 2: Run `npm test` and confirm RED** because catalog/chat service is missing.
- [ ] **Step 3: Implement orchestration** so the user message persists before network I/O, provider response persists only after successful completion, and all runs clear their active-run guard in `finally`.
- [ ] **Step 4: Run `npm test` and `npm run check`; expect zero failures.**
- [ ] **Step 5: Commit** with `git commit -m "feat: orchestrate streamed chat turns"`.

### Task 4: VS Code storage adapters and provider setup wizard

**Files:**
- Create: `src/yisi/vscode/provider/vsCodeProviderConfigurationRepository.ts`
- Create: `src/yisi/vscode/provider/vsCodeSecretStore.ts`
- Create: `src/yisi/vscode/provider/providerSetupWizard.ts`
- Modify: `src/yisi/index.ts`
- Delete: `src/yisi/llm/providerRegistry.ts`
- Create: `test/vscode-provider-adapters.test.js`

**Interfaces:**
- Produces storage adapters around injected VS Code-like mementos/SecretStorage for unit testing.
- Produces `ProviderSetupWizard.run()` and `pickModelForSession()`.

- [ ] **Step 1: Write failing adapter tests** for separate global/workspace state, secret CRUD, migration-safe parsing, and no secret leakage in mementos.
- [ ] **Step 2: Run `npm test` and confirm RED.**
- [ ] **Step 3: Implement adapters and the QuickPick/InputBox flow** with password input, credential-source restrictions, discovery timeout, explicit save-without-test choice, and model selection persistence.
- [ ] **Step 4: Run `npm test`, `npm run check`, and `npm run compile`; expect zero failures.**
- [ ] **Step 5: Commit** with `git commit -m "feat: add provider setup and model selection"`.

### Task 5: Host streaming lifecycle and Webview rendering

**Files:**
- Modify: `src/yisi/ui/chatViewProvider.ts`
- Modify: `src/yisi/ui/chatViewHtml.ts`
- Modify: `src/yisi/ui/webviewProtocol.ts`
- Modify: `test/webview-protocol.test.js`
- Create: `test/chat-view-source.test.js`

**Interfaces:**
- Host events: `assistantStreamStarted`, `assistantStreamDelta`, `assistantStreamCompleted`, `runStopped`, `sessionError`, and authoritative `sessionState`.
- Composer switches between Send and Stop and renders one transient assistant item via `textContent`.

- [ ] **Step 1: Write failing tests** for new protocol messages, source-level absence of `innerHTML`, run-state button behavior markers, and controller cancellation behavior through an extracted testable run coordinator.
- [ ] **Step 2: Run `npm test` and confirm RED.**
- [ ] **Step 3: Implement host/UI streaming** with one active AbortController, disabled concurrent send, Stop propagation, transient bubble cleanup, model label updates, and normalized errors.
- [ ] **Step 4: Run `npm test`, `npm run check`, and `npm run compile`; expect zero failures.**
- [ ] **Step 5: Commit** with `git commit -m "feat: stream provider responses in chat UI"`.

### Task 6: Documentation, regression verification, and integration

**Files:**
- Modify: `README.md`
- Modify: `docs/20_UI_RUNNABLE_IMPLEMENTATION.md`
- Modify: `docs/12_ROADMAP_AND_DOD.md`
- Modify: `src/yisi/storage/README.md`

**Interfaces:**
- Records exact implemented behavior and remaining v0.1 gaps without claiming real external connectivity when unavailable.

- [ ] **Step 1: Update documentation** for secure provider setup, local compatible endpoints, streaming, Stop, and verification boundaries.
- [ ] **Step 2: Run fresh completion verification:** `npm test`, `npm run check`, `npm run compile`, `git diff --check`, and `git status --short`.
- [ ] **Step 3: Attempt Extension Development Host smoke validation** without interfering with an occupied user window; report any environment blocker.
- [ ] **Step 4: Commit** with `git commit -m "docs: record provider streaming baseline"`.
- [ ] **Step 5: Fast-forward merge the verified feature branch into `main`, rerun all tests, and delete the merged branch.**
