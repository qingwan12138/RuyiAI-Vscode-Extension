# Diagnostics Validation Design

## Goal

Add honest, bounded VS Code diagnostic snapshots as a second validation evidence source without coupling application or domain code to `vscode`.

## Selected slice

The domain owns a `DiagnosticProvider` port and normalized snapshot types. A structurally typed VS Code adapter reads `languages.getDiagnostics()`, accepts only diagnostics belonging to explicitly configured workspace folders, sorts them deterministically, and caps retained items. The first slice reports snapshots independently; command and diagnostic evidence are composed in the following Agent validation planner slice.

## Safety boundaries

- Read-only; no file, process, network, or secret mutation.
- No Webview access to VS Code APIs.
- Workspace membership is determined by the host facade, not string-prefix path checks.
- Cancellation is checked before and during collection.
- A zero-error claim includes snapshot counts and truncation state.
- No diagnostics provider or inaccessible host means unavailable evidence, never an inferred pass.

## Clean-room and dependencies

This follows the repository architecture contract and VS Code public diagnostics behavior only. No external implementation or new package is used.
