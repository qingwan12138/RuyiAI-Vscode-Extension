# Storage rules

- API keys / OAuth tokens: VS Code `SecretStorage` only.
- Session metadata/history: local only; no cloud sync in v1.
- Existing sessions persist until the user deletes them.
- Model and permission mode are stored per session.
- New workspace/re-clone defaults to Plan.
- Session metadata and conversation items are stored in a schema-versioned JSON document under `ExtensionContext.globalStorageUri`.
- JSON writes use a sibling temporary file followed by rename and are serialized to prevent lost updates.
- The legacy `workspaceState` metadata key is cleared only after a successful import.
