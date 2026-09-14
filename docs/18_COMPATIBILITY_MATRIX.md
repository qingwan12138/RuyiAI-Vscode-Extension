# 18 — Compatibility Matrix

状态：v0.9 RC 兼容矩阵（2026-09-05）。正式交付场景为 **Linux 本机 VS Code**（docs/16）；以下矩阵与本机当前可验证状态一致，真实 Linux 主机验收项另列。

## Runtime engines

| component | version | notes |
| --- | --- | --- |
| VS Code (Extension Host) | `^1.95.0` (declared `engines.vscode`) | Extension host runtime provides Node/Electron; no separate Node engine requirement on the host. |
| TypeScript (build) | `^5.7.0` | `tsc` compile, `npm run compile`. |
| Node (build/test on dev machine) | `>=18` (current host uses Node 24) | `node --test` runs the entire suite; fixture subprocesses run real Node. |
| @types/node / @types/vscode | `^22.0.0` / `^1.95.0` | Dev-only types; no runtime dependency. |

## Operating systems

| OS | target (v0.9/v1.0) | status |
| --- | --- | --- |
| Linux Desktop / Workstation | **P0 (formal target)** | Implementation is Linux-first (docs/16). Real Linux LNX smoke test (LNX-001..020) is a delivery acceptance item on a RuyiSDK-equipped Linux host. |
| Windows (native) | not the formal target | Used as the current dev/test host; the full `node --test` suite passes here (659 tests). Note: this shell's `TEMP` is the 8.3 short form (`C:\Users\202511~1\…`) while git reports canonical long paths, so `node-worktree-manager.test.js` compares a short path against a long one and fails spuriously; run the suite with a canonical `TEMP` to get the real result. |
| macOS (native) | not the formal target | Not exercised. |
| VS Code Remote-SSH / Container / WSL | **not in v1.0** | Abstractions kept (ExecutionWorkspace, PlatformAdapter, ProcessRunner) but no remote logic implemented; no `if remote...` in Agent Core. |

## Runtime dependencies (all pure JS, no native addons)

| package | version | license | use |
| --- | --- | --- | --- |
| pdfjs-dist | 4.10.38 (legacy ESM via dynamic `import()`) | Apache-2.0 | PDF text + scanned-page raster decode. **Security floor: >= 4.2.67** (CVE-2024-4367 / GHSA-wgrm-67xf-hhpq). 5.x/6.x need Node >=22.13 and are therefore not usable while `engines.vscode` is `^1.95.0` (Node 20.18.1). Guarded by `test/pdf-real-extractor.test.js`. |
| mammoth | 1.12.2 | BSD-2-Clause | .docx text extraction |
| read-excel-file | 9.3.10 | MIT | .xlsx read-only parser |
| jszip | 3.10.1 | MIT | Office container reads + zip-bomb guard |

All are registered in `THIRD_PARTY_NOTICES.md` and enforced by `test/dependency-notices.test.js`. No native addon is permitted without explicit architecture/ABI/license review.

## Compilation / packaging

- Build: `tsc -p ./` → `dist/`. No bundler; VS Code loads `dist/extension.js` (CJS).
- Extension id: `yisi-ai-local.yisi-ai-dev-starter` (dev). Release packaging (one VSIX) is a v1.0 delivery item.
- No `postinstall` / no native build step.

## Test matrix (verified on Windows dev host)

| area | count | notes |
| --- | --- | --- |
| full `node --test test/*.test.js` | **701 tests / 700 pass / 0 fail (1 skip)** | 1 skip = Windows symlink case in the workspace FS suite. |
| Native (server-side) search backend (`test/websearch-native-backend.test.js`) | 14 pass | The provider's own web search used as a search backend: the request declares only the documented server tool, results come from structured blocks with the provider's prose discarded, a repeated URL is deduplicated, a response with no search block is an error rather than an empty result, a provider error code is surfaced, an HTTP failure names the endpoint and redacts the key, and the backend-selection precedence (explicit beats implicit, `none` really disables). |
| Web search MCP server (`test/websearch-mcp.test.js`) | 14 pass | The two web tools end to end **offline**: a real `AgentToolLoop` calls `mcp__websearch__web_search` through the real MCP client and bridge over an in-memory transport, a fake backend answers, and the result reaches the model's next round. Also the SSRF policy refusing before any request, same-origin redirects only, non-text refusal, cancellation, honest failure with no backend, and Plan mode refusing it with `reason: 'policy'`. |
| Web search URL policy (`test/websearch-url-policy.test.js`) | 12 pass | URL and address policy: scheme, embedded credentials, length, private/loopback/link-local/metadata refusal, IPv4 **and** IPv6 including `::ffff:`-mapped and dotted-quad tails, unrecognised addresses refused rather than allowed, same-origin redirects, HTML-to-text, bounded bodies, and an assertion that the defaults still match `docs/14`. |
| Headless / CI (`test/headless.test.js`) | 14 pass | Approval policy (read-only by default, opt-in, fail-closed for destructive), argument contract, **and a real end-to-end run on a temp directory with no VS Code**: the default run cannot write, the opt-in run really writes to disk. |
| Docs consistency (`test/docs-consistency.test.js`) | 6 pass | The documents claiming the **current** state (matrix, handover, newest roadmap evidence) must agree; dated reports must be marked historical; every ADR the handover indexes must exist. Historical per-milestone numbers are deliberately not constrained. |
| real-dependency PDF extraction (`test/pdf-real-extractor.test.js`) | 5 pass | Loads the real pdfjs-dist 4.10.38 through the production loader (dynamic ESM import + worker preload); guards the CVE-2024-4367 version floor and the extension-host Node floor. |
| session auto-titling (`test/session-title.test.js`, `test/session-auto-title.test.js`) | 13 pass | Pure prompt/parse logic plus the ChatService hook: one bare extra request after the first exchange, never over a user rename. |
| agent-loop e2e (v0.2/v0.3 DoD) | pass | real tools + real `node calc.test.mjs`. **The old "flaky under parallelism" note is resolved**: the tests edited a checked-in fixture in the repository working tree, which made the tree the shared mutable state between concurrent runs. Each test now runs against a **temp copy** (`test/support/fixtureCopy.js`), so the race is structurally impossible. Evidence: three concurrent runs of both e2e files → each `pass 3 / fail 0`, all exit 0, and `git status test/fixtures` stays clean. |
| session worktree isolation (v0.4 DoD) | pass | real git repo. |
| MCP stdio transport (`test/mcp-stdio-transport.test.js`) | 8 pass | Spawns a real child process over piped stdio; verifies cancellation keeps the connection usable and that `close()` reaps the child (pid probe, not the child's own exit handler — Windows terminates without running JS handlers). |
| Hook executor (`test/hooks-process.test.js`) | 14 pass | Real hook child processes: stdin JSON contract, deny/allow/plain-text, malformed and **undefined** decisions (an unknown verdict must never read as permission), non-zero exit with stderr, timeout kills the process, cancellation. |
| Subagents (`test/subagents.test.js`) | 14 pass | Isolation contract (task only, no parent history), the filtered read-only registry (no privileged tool, no escalation, no nesting), report-only return, budget, namespaced UI events, and abort propagation into the child. |
| Checkpoints (`test/checkpoints.test.js`) | 15 pass | Turn recording and bounds, the newest-first rewind plan, and — through the real edit service over an in-memory workspace — restoring changed/deleted/created files, refusing a file the user edited since (never clobbering it), and forking at the turn boundary. |
| Proposal diff (`test/proposal-diff.test.js`) | 10 pass | Whole-file before/after content, skipping (never faking) a replacement that no longer matches uniquely, verbatim CRLF, size bounds, plus source-level invariants that the diff cannot approve anything and opens before the decision is awaited. |
| Plan review (`test/plan-review.test.js`) | 11 pass | The review document, feedback as only the changed lines, and — through the real loop — the plan reaching the port, comments reaching the model on approval *and* on refusal, and a boolean-only port still working. |

## Known environment-dependent acceptance (not claimed as passed on this host)

- v0.1 real-cloud-account networking acceptance.
- v0.6 real Ruyi CLI / RISC-V fixture end-to-end workflow.
- v0.8 merge into the upstream `ruyisdk-vscode-extension` repo + original RuyiSDK regression.
- Linux LNX-001..020 real-host smoke test.
- v1.0 VSIX build + install/maintenance docs + final NOTICE/test report on the release environment.
