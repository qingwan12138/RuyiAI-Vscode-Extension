# Diagnostics Validation Implementation Plan

**Goal:** Produce bounded workspace diagnostic snapshots behind a domain port, then make them available to validation orchestration.

**Architecture:** Domain types stay host-neutral. A VS Code adapter consumes a narrow injected facade so normalization is testable without loading the VS Code runtime. Application validation will consume only the port.

**Tech Stack:** TypeScript, VS Code public API, Node built-in tests, no new dependency.

### Task 1: Domain port and VS Code adapter

- [x] Write failing tests for workspace filtering, severity normalization, deterministic ordering, bounds, cancellation, and unavailable host state.
- [x] Implement `DiagnosticProvider` domain types and the structurally typed VS Code adapter.
- [x] Run focused/full tests and typecheck.
- [x] Commit the adapter baseline.

### Task 2: Validation composition

- [x] Write failing tests for diagnostic pass/fail/unavailable/truncated evidence.
- [x] Extend validation orchestration without weakening structured command validation.
- [ ] Wire the adapter at the Extension Host composition root.
- [ ] Verify, document, merge to main, then continue the Agent tool loop.
