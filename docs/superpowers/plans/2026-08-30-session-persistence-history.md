# Session Persistence and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist workspace-scoped sessions and user/assistant messages, restore the active session after restart, and provide history switching, rename, and confirmed deletion in the existing Webview.

**Architecture:** A VS Code-free domain model is operated by `SessionService` through a repository port. `JsonSessionRepository` stores a versioned document with atomic replacement, while the VS Code Webview adapter validates typed messages and renders state supplied by the service.

**Tech Stack:** TypeScript 5.7, Node.js standard library, VS Code Extension API, Node built-in test runner, vanilla Webview HTML/CSS/JavaScript.

## Global Constraints

- Milestone is v0.1 Foundation / Chat Vertical Slice.
- Product code remains TypeScript/JavaScript; no second runtime or native dependency.
- Domain and application modules do not import `vscode`.
- The Webview does not read files, spawn commands, access secrets, or claim baseline notices are LLM output.
- Storage is local under `ExtensionContext.globalStorageUri`, schema-versioned, and replaced atomically.
- New sessions default to Plan mode.
- The visible sidebar starts with the Session navigation bar; no redundant Yisi AI View title is added.
- Existing theme-adaptive Ruyi mask branding remains intact.

---

### Task 1: Canonical session domain and test harness

**Files:**
- Create: `src/yisi/domain/session.ts`
- Delete: `src/yisi/domain/sessionModel.ts`
- Delete: `src/yisi/session/types.ts`
- Modify: `src/yisi/permissions/permissionEngine.ts`
- Modify: `package.json`
- Create: `test/session-domain.test.js`

**Interfaces:**
- Produces: `PermissionMode`, `ConversationItem`, `YisiSession`, `WorkspaceSessionState`, `SessionDocument`, `SessionSummary`, `parseSessionDocument(value: unknown): SessionDocument`.
- Consumes: only JavaScript primitives; no VS Code API.

- [ ] **Step 1: Add the Node test command and failing domain tests**

Add `"test": "npm run compile && node --test test"` to `package.json`. Test valid parsing, rejection of unsupported `schemaVersion`, rejection of malformed conversation items, and defensive copying through the public parser.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSessionDocument } = require('../dist/yisi/domain/session');

test('parseSessionDocument accepts a version 1 workspace document', () => {
  const document = parseSessionDocument({ schemaVersion: 1, workspaces: {} });
  assert.deepEqual(document, { schemaVersion: 1, workspaces: {} });
});

test('parseSessionDocument rejects future schema versions', () => {
  assert.throws(() => parseSessionDocument({ schemaVersion: 2, workspaces: {} }), /Unsupported session schema/);
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npm test`
Expected: compile or test failure because `parseSessionDocument` does not exist.

- [ ] **Step 3: Implement the canonical domain model and parser**

Use discriminants `type: 'userMessage' | 'assistantMessage'`, numeric timestamps, `titleSource: 'manual' | 'ai' | 'fallback'`, and `source: 'baseline' | 'provider'`. The parser must validate every persisted field and throw `SessionSchemaError` for unsupported or malformed input.

```ts
export interface SessionDocument {
  schemaVersion: 1;
  workspaces: Record<string, WorkspaceSessionState>;
}

export interface WorkspaceSessionState {
  activeSessionId?: string;
  sessions: YisiSession[];
}

export function parseSessionDocument(value: unknown): SessionDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.workspaces)) {
    throw new SessionSchemaError('Unsupported session schema or malformed session document.');
  }
  return cloneValidatedDocument(value);
}
```

Update `PermissionEngine` to import `PermissionMode` from `../domain/session` and remove both obsolete session model files.

- [ ] **Step 4: Run tests and typecheck for GREEN**

Run: `npm test` and `npm run check`
Expected: all domain tests pass; TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json src/yisi/domain/session.ts src/yisi/domain/sessionModel.ts src/yisi/session/types.ts src/yisi/permissions/permissionEngine.ts test/session-domain.test.js
git commit -m "feat: define canonical session domain"
```

### Task 2: Atomic JSON repository

**Files:**
- Create: `src/yisi/application/session/sessionRepository.ts`
- Create: `src/yisi/infrastructure/persistence/jsonSessionRepository.ts`
- Create: `test/json-session-repository.test.js`

**Interfaces:**
- Produces: `SessionRepository.load(): Promise<SessionDocument | undefined>` and `SessionRepository.save(document: SessionDocument): Promise<void>`.
- Produces: `JsonSessionRepository(storageDirectory: string, fileName?: string)`.
- Consumes: `SessionDocument` and `parseSessionDocument` from Task 1.

- [ ] **Step 1: Write failing repository tests**

Use `fs.promises.mkdtemp`, a path under `os.tmpdir()`, and test round-trip persistence, missing-file behavior, corrupt-file preservation, and ordered concurrent saves.

```js
test('round trips a session document', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'yisi-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new JsonSessionRepository(directory);
  await repository.save({ schemaVersion: 1, workspaces: {} });
  assert.deepEqual(await repository.load(), { schemaVersion: 1, workspaces: {} });
});
```

- [ ] **Step 2: Run the repository test and confirm RED**

Run: `npm test`
Expected: failure because `JsonSessionRepository` is missing.

- [ ] **Step 3: Implement queued atomic saves**

Use `mkdir({ recursive: true })`, `writeFile(temp, json, { encoding: 'utf8', mode: 0o600 })`, and `rename(temp, target)`. Chain saves through a private promise and clean the unique temp file in `finally`. Wrap I/O errors in `SessionPersistenceError` without embedding document content.

```ts
save(document: SessionDocument): Promise<void> {
  const snapshot = parseSessionDocument(document);
  const operation = () => this.writeAtomically(snapshot);
  this.queue = this.queue.then(operation, operation);
  return this.queue;
}
```

- [ ] **Step 4: Run tests and typecheck for GREEN**

Run: `npm test` and `npm run check`
Expected: repository tests and domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/yisi/application/session/sessionRepository.ts src/yisi/infrastructure/persistence/jsonSessionRepository.ts test/json-session-repository.test.js
git commit -m "feat: add atomic session repository"
```

### Task 3: Session application service and legacy import

**Files:**
- Create: `src/yisi/application/session/sessionService.ts`
- Delete: `src/yisi/session/sessionStore.ts`
- Create: `test/session-service.test.js`

**Interfaces:**
- Produces: `SessionService.initialize`, `listSessions`, `getActiveSession`, `createSession`, `switchSession`, `renameSession`, `deleteSession`, `appendUserMessage`, and `appendAssistantMessage`.
- Produces: `LegacySessionMetadata` and initialization result `{ importedLegacy: boolean }`.
- Consumes: `SessionRepository` from Task 2 and canonical domain types from Task 1.

- [ ] **Step 1: Write failing service behavior tests**

Use an in-memory repository and injected `now()` / `createId()` functions. Cover blank initialization, newest-first summaries, switching, manual rename, unknown IDs, deletion fallback, message ordering, persistence failure rollback, and reconstruction over the same repository.

```js
test('deleting the final session creates and activates a blank replacement', async () => {
  const service = createService();
  await service.initialize('workspace-a', []);
  const original = service.getActiveSession();
  await service.deleteSession(original.id);
  assert.notEqual(service.getActiveSession().id, original.id);
  assert.equal(service.listSessions().length, 1);
});
```

- [ ] **Step 2: Run service tests and confirm RED**

Run: `npm test`
Expected: failure because `SessionService` is missing.

- [ ] **Step 3: Implement transactional service mutations**

Each mutation clones the current document, changes the clone, awaits repository save, and only then replaces in-memory state. Serialize service mutations with a queue. Trim input and throw `SessionInputError` for empty text/title and `SessionNotFoundError` for unknown IDs.

```ts
private async mutate(change: (draft: SessionDocument) => void): Promise<void> {
  const next = parseSessionDocument(this.document);
  change(next);
  await this.repository.save(next);
  this.document = next;
}
```

Legacy import accepts the current baseline metadata shape, adds empty `items`, maps `userRenamed` to `titleSource`, and saves before reporting `importedLegacy: true`.

- [ ] **Step 4: Run tests and typecheck for GREEN**

Run: `npm test` and `npm run check`
Expected: all service, repository, and domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/yisi/application/session/sessionService.ts src/yisi/session/sessionStore.ts test/session-service.test.js
git commit -m "feat: add session application service"
```

### Task 4: Validated Webview protocol and host wiring

**Files:**
- Create: `src/yisi/ui/webviewProtocol.ts`
- Modify: `src/yisi/index.ts`
- Modify: `src/yisi/ui/chatViewProvider.ts`
- Create: `test/webview-protocol.test.js`

**Interfaces:**
- Produces: `parseWebviewMessage(value: unknown): WebviewMessage`.
- Consumes: `SessionService` and `JsonSessionRepository`.
- Host state message: `{ type: 'sessionState'; sessions: SessionSummary[]; activeSession: YisiSession }`.

- [ ] **Step 1: Write failing protocol validation tests**

Cover valid messages and reject missing IDs, blank titles/text, unexpected fields, arrays, and unknown message types.

```js
test('rejects a switch message without a session id', () => {
  assert.throws(() => parseWebviewMessage({ type: 'switchSession' }), /Invalid Webview message/);
});
```

- [ ] **Step 2: Run protocol tests and confirm RED**

Run: `npm test`
Expected: failure because `parseWebviewMessage` is missing.

- [ ] **Step 3: Implement exhaustive protocol parsing and wire services**

Construct `JsonSessionRepository(context.globalStorageUri.fsPath)` and `SessionService` in `registerYisiAI`. Initialize the provider from the current workspace identity and legacy `workspaceState` value. Clear `yisiAI.sessions.v1` only after successful import.

`YisiChatViewProvider` parses every inbound `unknown`, delegates mutations to `SessionService`, and posts a complete `sessionState` only after persistence succeeds. Errors post `{ type: 'sessionError', message }` with fixed safe copy and log only error class/message.

- [ ] **Step 4: Run tests and typecheck for GREEN**

Run: `npm test` and `npm run check`
Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/yisi/ui/webviewProtocol.ts src/yisi/index.ts src/yisi/ui/chatViewProvider.ts test/webview-protocol.test.js
git commit -m "feat: connect session service to webview"
```

### Task 5: History UI, persisted conversation rendering, and final verification

**Files:**
- Create: `src/yisi/ui/chatViewHtml.ts`
- Modify: `src/yisi/ui/chatViewProvider.ts`
- Modify: `docs/20_UI_RUNNABLE_IMPLEMENTATION.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `sessionState` and `sessionError` host messages from Task 4.
- Produces Webview requests: `newChat`, `switchSession`, `renameSession`, `deleteSession`, and `sendMessage`.

- [ ] **Step 1: Extract HTML generation without changing rendered behavior**

Move the current HTML/CSS/script generator and nonce creation into `chatViewHtml.ts`. `chatViewProvider.ts` calls `createChatViewHtml(webview, extensionUri)`.

- [ ] **Step 2: Run the existing full test and build baseline**

Run: `npm test`, `npm run check`, and `npm run compile`
Expected: all tests pass and both build commands exit 0 before UI behavior changes.

- [ ] **Step 3: Add the history panel and state-driven rendering**

Add an in-Webview dialog/panel using VS Code theme variables. Render session summaries as buttons, show active state with `aria-current`, provide rename and delete controls, and require a second confirmation click or `window.confirm` before `deleteSession`. Escape all user content by assigning `textContent`, never `innerHTML`.

On `sessionState`, replace local session state and render the active session's persisted items. Submission sends only the request; the message appears after the host returns persisted state. Baseline assistant items must visibly say the LLM provider is not connected.

- [ ] **Step 4: Update documentation**

Record that session metadata/messages, restart restoration, switching, rename, and deletion are implemented. Keep real LLM, provider selection, tool cards, and permission selection listed as not implemented.

- [ ] **Step 5: Run fresh completion verification**

Run:

```bash
npm test
npm run check
npm run compile
git diff --check
git status --short
```

Expected: tests report zero failures; typecheck and compile exit 0; `git diff --check` emits no errors; status contains only the intended Task 5 files before commit.

- [ ] **Step 6: Commit**

```bash
git add src/yisi/ui/chatViewHtml.ts src/yisi/ui/chatViewProvider.ts docs/20_UI_RUNNABLE_IMPLEMENTATION.md README.md
git commit -m "feat: add persistent session history UI"
```

- [ ] **Step 7: Review final repository state**

Run: `git log --oneline -7` and `git status --short --branch`
Expected: the design, plan, and five implementation commits are visible; the working tree is clean.
