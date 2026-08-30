# 17 — Implementation Language & Dependency Contract

## 1. Decision

Yisi AI adopts **TypeScript / JavaScript as the only normal implementation languages for self-developed product code**.

This is a project architecture constraint, not a claim that every file involved in development must be TS/JS.

### Mandatory
Yisi AI self-developed implementation:
- VS Code extension host code → TypeScript / JavaScript
- Agent Core → TypeScript
- Tool system → TypeScript
- Session / Turn / AgentRun → TypeScript
- Permission Engine → TypeScript
- Context Engine → TypeScript
- LLM Provider layer → TypeScript
- Ruyi integration adapters → TypeScript
- Git / process / validation orchestration → TypeScript
- Webview application → TypeScript / JavaScript
- persistence and configuration logic → TypeScript

Prefer TypeScript for source code. JavaScript is allowed where generated output, tooling, configuration, or an upstream integration context makes it appropriate.

## 2. What this rule does NOT mean

The following are allowed and do not violate the rule:

### External tools
Yisi may invoke external programs implemented in any language, for example:
- `ruyi`
- `git`
- `gcc`
- `clang`
- `cmake`
- `make`
- `ninja`
- `lld`
- `gdb`
- `llama.cpp` server

Yisi communicates with them through CLI, process APIs, HTTP, or another explicit boundary.

### Target-project fixtures
Tests may contain source code in languages Yisi is supposed to understand or repair:
- C
- C++
- Python
- Rust
- Java
- shell
- etc.

Those files are test inputs, not Yisi implementation.

### Third-party package internals
A dependency may internally contain native or other-language code, but such a dependency is not automatically approved. See the exception process below.

## 3. Default prohibition

Coding Agents MUST NOT casually introduce:
- a Python backend for Yisi
- a Rust daemon
- a Go service
- a C/C++ helper executable
- a Java service
- a second independent runtime merely for convenience
- native Node addons without review

Do not translate an open-source reference architecture by importing its original implementation language into Yisi.

Example:

```text
Aider uses Python
        ↓
Learn repo-map/context ideas
        ↓
Implement Yisi equivalent in TypeScript
```

Not:

```text
Yisi TypeScript extension
        ↓
spawn bundled Python Aider-like backend
```

## 4. Native dependency exception

Native addons or non-TS/JS self-developed components are **exception-only**, not absolutely impossible.

Before approval, document:

1. What capability is required?
2. Why a pure TS/JS implementation is insufficient?
3. Why an external process/service boundary is not preferable?
4. Linux packaging impact.
5. VS Code/Electron/Node ABI impact.
6. x86_64 / arm64 / future riscv64 impact.
7. installation/offline deployment impact.
8. security impact.
9. license compatibility with a closed-source deliverable.
10. maintenance burden.
11. upstream RuyiSDK extension integration impact.
12. fallback/removal strategy.

No Coding Agent may add the dependency before this review is accepted.

## 5. Dependency preference order

When choosing a library:

1. VS Code official API.
2. Node.js standard API.
3. small, actively maintained pure TypeScript/JavaScript package.
4. larger JS/TS framework only when it removes meaningful complexity.
5. native addon only after architecture approval.
6. bundled secondary-language runtime only as an exceptional last resort.

Avoid dependencies merely to save a few lines of code.

## 6. First-party source policy

Recommended:

```text
src/**/*.ts
webview/**/*.ts / *.tsx
scripts/**/*.js / *.mjs / *.ts
config → JS/JSON where appropriate
dist/**/*.js → generated
```

Do not commit generated JS beside every TS source unless the build system requires it.

## 7. Webview

Preferred:
- TypeScript
- React only if UI complexity justifies it
- VS Code Webview API
- CSS

React is a UI library choice, not an architecture requirement.

Do not put Agent Core, secrets, process spawning, filesystem authority, or Permission Engine into Webview code.

## 8. LLM SDKs

Provider-specific SDKs are optional.

Prefer a common Yisi-owned abstraction:

```text
Agent Core
  ↓
LLMGateway
  ↓
LLMProvider
```

Provider SDK types must not leak into Agent Core.

If a provider supports a stable HTTP API and its SDK adds unnecessary weight, a small typed HTTP adapter may be preferable.

## 9. External tool boundary

All external programs should be accessed through owned ports/adapters:

```text
RuyiPort → RuyiCliAdapter
GitPort → GitCliAdapter
ProcessRunner → NodeProcessRunner
LLMProvider → HTTP/SDK adapter
```

This keeps the TypeScript core independent of the implementation language of external tools.

## 10. Closed-source / open-source reference rule

Reference projects may teach architecture, UX, protocols, or engineering patterns.

They are NOT automatically dependencies and are NOT source-code suppliers.

For each reference:
- record project and license
- record what concept is being studied
- implement the Yisi version independently
- do not copy substantial source files
- do not copy proprietary prompts/branding/assets
- do not assume permissive license means copying is desirable for this contract project

Primary references currently include:
- Claude Code: product behavior patterns
- OpenAI Codex: agent/thread/tool/worktree behavior patterns
- Cline: VS Code agent architecture ideas
- Aider: repo-map/Git/context ideas
- Continue: IDE/core boundary ideas
- VS Code official extension APIs: host integration baseline

See the dedicated open-source reference/license documents for exact boundaries.

## 11. AI coding guardrail

Before adding a dependency or new runtime, the Coding Agent must answer:

- Can VS Code API already do this?
- Can Node.js standard library do this?
- Can this be implemented cleanly in TypeScript?
- Is the package pure JS/TS?
- Does it introduce native binaries?
- Does it add a new runtime?
- Does it create licensing obligations?
- Does it make final merging into ruyisdk-vscode-extension harder?

If a new runtime/native component is proposed, stop implementation and raise an architecture decision instead.

## 12. Acceptance criteria

LANG-001 First-party production source is TS/JS.
LANG-002 No Python/Rust/Go/C++ backend is required to start Yisi.
LANG-003 External Ruyi/Git/compiler/model tools remain behind adapters.
LANG-004 No unreviewed native addon exists.
LANG-005 Build works with the declared Node/npm toolchain.
LANG-006 Webview contains no privileged backend logic.
LANG-007 Provider SDK types do not leak into Agent Core.
LANG-008 Dependency inventory and licenses can be generated/reviewed.
LANG-009 Test fixtures in other languages are clearly separated from Yisi implementation.
LANG-010 Open-source reference code has not been directly transplanted into first-party implementation.
