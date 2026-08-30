# ADR-0002 — TypeScript / JavaScript Primary Implementation

## Status
Accepted

## Decision
Yisi AI first-party product implementation uses TypeScript / JavaScript only under normal circumstances, with TypeScript preferred.

External tools implemented in other languages are allowed behind explicit adapters.

Native addons or self-developed non-TS/JS components are exception-only and require architecture approval.

## Why
- Align with the upstream RuyiSDK VS Code extension technology stack.
- Reduce integration and maintenance cost.
- Avoid unnecessary multi-runtime architecture.
- Keep VSIX development/build/debug straightforward.
- Reduce vibe-coding dependency sprawl.
- TS/JS is sufficient for the planned Agent Core, providers, tools, context, session, permissions, Ruyi orchestration, Git, validation and Webview.

## Non-goal
This ADR does not forbid C/C++/Python/etc. files in test fixtures or external toolchains.
