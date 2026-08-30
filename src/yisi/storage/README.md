# Storage rules

- API keys / OAuth tokens: VS Code `SecretStorage` only.
- Session metadata/history: local only; no cloud sync in v1.
- Existing sessions persist until the user deletes them.
- Model and permission mode are stored per session.
- New workspace/re-clone defaults to Plan.
- Session metadata and conversation items are stored in a schema-versioned JSON document under `ExtensionContext.globalStorageUri`.
- JSON writes use a sibling temporary file followed by rename and are serialized to prevent lost updates.
- The legacy `workspaceState` metadata key is cleared only after a successful import.
- Provider metadata is stored globally under the schema-versioned `yisiAI.providerConfigurations.v1` memento key.
- Workspace model defaults use the separate `yisiAI.workspaceProviderDefault.v1` workspace memento key.
- Provider API keys use opaque `yisiAI.provider.<providerId>.apiKey` SecretStorage keys and never enter provider/session JSON or Webview messages.
- An environment credential stores only its variable name; the value is resolved in the Extension Host at request time.
- A streamed assistant response is persisted only after the provider stream completes. Interrupted partial text remains transient UI state.
- Explicit file attachments persist only `{ type, path, workspaceFolderUri }` references on the user message. Raw file content remains transient in the Extension Host and is cleared after the next send.
- Implicit text search skips common credential-bearing files (`.env*`, `.npmrc`, `.pypirc`, `.netrc`, `*.pem`, `*.key`) and never reads `.gitignore` content by default.
