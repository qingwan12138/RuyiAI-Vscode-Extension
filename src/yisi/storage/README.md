# Storage rules

- API keys / OAuth tokens: VS Code `SecretStorage` only.
- Session metadata/history: local only; no cloud sync in v1.
- Existing sessions persist until the user deletes them.
- Model and permission mode are stored per session.
- New workspace/re-clone defaults to Plan.
