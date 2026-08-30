# Session Persistence and History Design

## Scope

This vertical slice belongs to roadmap milestone v0.1 Foundation / Chat Vertical Slice. It delivers durable workspace-scoped sessions, persisted user and assistant messages, restart recovery, and a usable history panel. It does not connect a real LLM provider or claim that placeholder responses are model output.

The user-visible operations are:

- create a session;
- list sessions for the current workspace;
- switch sessions and restore their messages;
- rename a session manually;
- delete a session after confirmation;
- append a user message and an explicitly labelled baseline assistant notice;
- restore the active session after extension or Webview restart.

## Architecture

Dependencies follow `ui -> application -> domain`, while infrastructure implements domain/application ports.

```text
Webview
  -> VS Code Webview adapter
  -> SessionService
  -> SessionRepository port
  <- JsonSessionRepository
```

The domain and application layers do not import `vscode`. The Webview never reads files directly. No new production dependency is introduced; runtime validation and migration use small handwritten TypeScript functions until a broader schema dependency is justified.

## Domain model

The duplicate session definitions are replaced by one canonical model. A persisted document has `schemaVersion: 1` and contains workspace buckets. Each workspace bucket records its active session and sessions.

`YisiSession` contains identity, workspace identity, title metadata, model selection, permission mode, timestamps, status, and a chronological `ConversationItem[]`.

Conversation items use a tagged union from the beginning:

- `UserMessage`: user-authored text;
- `AssistantMessage`: assistant-visible text with `source: "baseline" | "provider"`.

Only these variants are persisted in this slice. Tool, diff, permission, terminal, validation, and Ruyi variants remain outside the model until their roadmap slices supply real behavior.

Manual renaming sets `titleSource` to `manual`, preventing later title generation from overwriting it. New sessions start in Plan mode and use an empty provider/model selection.

## Persistence and migration

The JSON repository stores one document under `ExtensionContext.globalStorageUri`. It receives a filesystem abstraction or storage directory path rather than importing VS Code.

Writes use this sequence:

1. serialize the complete next document;
2. create the storage directory if needed;
3. write a sibling temporary file;
4. rename the temporary file over the target;
5. clean up the temporary file on failure when possible;
6. surface a normalized persistence error instead of reporting success.

Repository operations are serialized through an internal promise queue so concurrent Webview actions cannot overwrite each other.

On first use, the application imports compatible metadata from the current `workspaceState` key `yisiAI.sessions.v1` when present. Imported sessions receive empty message arrays and normalized title metadata. After a successful file write, the legacy key is cleared. Invalid JSON or unsupported schema versions produce an explicit error and preserve the original file.

Workspace identity remains the normalized VS Code workspace-file URI or sorted workspace-folder URI set used by the current baseline. A no-workspace window has its own `no-workspace` bucket.

## Application service

`SessionService` owns session behavior:

- `initialize(workspaceId, legacySessions)` loads, migrates, and selects the most recently updated session, creating one when none exists;
- `listSessions()` returns newest-first summaries;
- `getActiveSession()` returns a copy of the active session;
- `createSession()` creates and activates a Plan-mode session;
- `switchSession(id)` changes the persisted active session;
- `renameSession(id, title)` trims and validates a non-empty title;
- `deleteSession(id)` removes the session and activates the next most recent session, creating a blank session if the last one was deleted;
- `appendUserMessage(text)` persists the user message;
- `appendAssistantMessage(text, source)` persists the assistant message.

All mutations persist before notifying the UI. Failures leave the last successfully persisted in-memory state active.

## Typed Webview protocol and UI

Inbound messages are parsed from `unknown` with an exhaustive validator. Invalid message shapes are rejected and surfaced as a non-sensitive error notice.

The protocol includes initialization, create, switch, rename, delete, send, settings, permission placeholder, context placeholder, stop, and continue requests. Host-to-Webview state messages contain session summaries plus the active session and its messages.

The history control opens a theme-adaptive panel inside the Webview. It provides keyboard-accessible session selection, rename, and delete controls. Delete uses a confirmation step. Closing or switching the panel does not mutate state. The current top-bar branding rule remains unchanged: no extra Yisi AI title row is introduced.

When a message is submitted, the host persists the user message and then persists an `AssistantMessage` whose `source` is `baseline` and whose copy clearly states that the provider is not connected. The UI renders persisted items on initialization and session switch, avoiding duplicate optimistic messages.

## Error handling

- Empty messages and empty titles are rejected before mutation.
- Unknown session IDs return a domain error and do not alter active state.
- Persistence failures are shown as concise system errors and logged without message contents or secrets.
- Corrupt or future-version storage is not overwritten automatically.
- Delete confirmation is cancelled safely without host mutation.

## Testing and verification

The repository gains a lightweight test runner suitable for TypeScript without adding production dependencies. Tests cover:

- domain parsing and schema rejection;
- legacy metadata migration;
- atomic repository round trips and corrupt-file preservation;
- concurrent mutation serialization;
- session creation, switching, rename semantics, deletion fallback, and message persistence;
- Webview inbound message validation;
- restoration after constructing a new service over the same storage.

Completion evidence requires the full unit test command, TypeScript check, compile, and a clean Git status review. Manual VS Code Extension Host UI verification is reported separately if the environment cannot automate it.

## Roadmap and change checklist

1. Milestone: v0.1 Foundation / Chat Vertical Slice.
2. Responsibilities changed: session domain, application session service, JSON persistence adapter, and Webview session presentation.
3. Cross-layer dependencies: none outside the architecture contract; infrastructure implements ports and VS Code constructs adapters.
4. Sensitive capabilities: local file writes under extension global storage. Atomic-write and failure tests provide evidence. No shell, network, or secret handling is added.
5. External reference: only the established behavior concepts in project documentation; no external source implementation is copied.
6. Verification: unit tests, typecheck, compile, and manual UI verification where available.
7. Confirmed product decisions: unchanged.
