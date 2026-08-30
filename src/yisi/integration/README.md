# RuyiSDK host integration boundary

Yisi AI should remain logically independent even when physically merged into the upstream RuyiSDK VS Code extension.

Hard dependencies:
1. VS Code public API.
2. Ruyi CLI programmatic interface, especially `ruyi --porcelain`.

Soft/optional dependencies:
- Existing `ruyi.*` VS Code commands for UI refresh or convenience only.
- Never import upstream internal services/providers/classes as Yisi core dependencies.

Preferred host seam:
```ts
await registerYisiAI(context);
```
