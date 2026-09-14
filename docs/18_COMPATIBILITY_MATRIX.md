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
| Windows (native) | not the formal target | Used as the current dev/test host; the full `node --test` suite passes here (419 tests). Note: this shell's `TEMP` is the 8.3 short form (`C:\Users\202511~1\…`) while git reports canonical long paths, so `node-worktree-manager.test.js` compares a short path against a long one and fails spuriously; run the suite with a canonical `TEMP` to get the real result. |
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
| full `node --test test/*.test.js` | **445 tests / 444 pass / 0 fail (1 skip)** | 1 skip = Windows symlink case in the workspace FS suite. |
| real-dependency PDF extraction (`test/pdf-real-extractor.test.js`) | 5 pass | Loads the real pdfjs-dist 4.10.38 through the production loader (dynamic ESM import + worker preload); guards the CVE-2024-4367 version floor and the extension-host Node floor. |
| session auto-titling (`test/session-title.test.js`, `test/session-auto-title.test.js`) | 13 pass | Pure prompt/parse logic plus the ChatService hook: one bare extra request after the first exchange, never over a user rename. |
| agent-loop e2e (v0.2/v0.3 DoD) | pass | real tools + real `node calc.test.mjs`. Known flaky under full-suite parallelism (`replace_text` sha race against a real subprocess): passes in isolation and on re-run. |
| session worktree isolation (v0.4 DoD) | pass | real git repo. |

## Known environment-dependent acceptance (not claimed as passed on this host)

- v0.1 real-cloud-account networking acceptance.
- v0.6 real Ruyi CLI / RISC-V fixture end-to-end workflow.
- v0.8 merge into the upstream `ruyisdk-vscode-extension` repo + original RuyiSDK regression.
- Linux LNX-001..020 real-host smoke test.
- v1.0 VSIX build + install/maintenance docs + final NOTICE/test report on the release environment.
