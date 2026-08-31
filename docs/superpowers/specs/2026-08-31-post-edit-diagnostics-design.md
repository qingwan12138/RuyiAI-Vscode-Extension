# Post-edit Diagnostics Snapshot — Design

## Goal

After a successful bounded workspace edit, return a bounded VS Code workspace diagnostic snapshot in the same structural tool result so the provider can inspect errors before claiming success or proposing a repair.

## Semantics

The edit remains the primary operation. Once the atomic rename succeeds, diagnostics failure, unavailability, or cancellation must never relabel the edit as failed or hide that mutation.

`replace_text` returns:

- `edit`: path, before/after SHA-256, replacement count, and resulting byte count;
- `diagnostics`: `snapshot` with bounded normalized items and total severity counts, or `unavailable`.

The evidence is explicitly an immediate snapshot, not a proof that language servers have finished recomputing and not a full build/test pass. No arbitrary process is started. The existing `ValidationEngine` remains the source for later completion-grade command/diagnostic plans.

## Cancellation correction

If Stop arrives after a mutating tool has returned successfully, the Agent loop reports that a workspace change was applied and stops before another provider round. Read-only tools keep ordinary abort behavior. This prevents a completed mutation from being presented as if nothing happened.

## Boundaries

The VS Code diagnostic adapter is injected through the domain `DiagnosticProvider` port. The edit application service does not import VS Code. Diagnostic collection errors are normalized to unavailable without exposing exception text. Diagnostics from implicitly sensitive paths such as `.env`, `.npmrc`, `.git`, key, and credential files are excluded before counting or retention. The production snapshot retains at most 50 diagnostic items while preserving total counts and truncation metadata.

## Verification

Tests cover snapshot inclusion, unavailable/failing diagnostic providers, cancellation after a completed mutation, no mutation cancellation regression, bounded production wiring by typecheck, and the full repository suite.
