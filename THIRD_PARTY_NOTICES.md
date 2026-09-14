# Third-Party Notices

当前 Blueprint 不声明已 vendoring Cline、Codex、Claude Code、Aider、Roo Code 或 Continue 的源代码。

实际开发新增 runtime/dev dependencies 后，在此登记：package/version/license/source/distribution notes。

> 注意：外部项目列入“参考矩阵”不代表其代码被包含在本项目中。

## Runtime parsing libraries (Context Attachment system, v0.1)

All libraries below are pure JavaScript/TypeScript (no native addons, no
node-gyp, no Python/OCR binaries). They are resolved lazily at attach time by
`createDefaultAttachmentRegistry` (see `src/yisi/infrastructure/attachment/`),
so the extension never pays their load cost during activation.

| package | version | license | notes |
| --- | --- | --- | --- |
| pdfjs-dist | 4.10.38 | Apache-2.0 | Mozilla PDF.js. **This version is the CVE-2024-4367 / GHSA-wgrm-67xf-hhpq fix floor**: 3.11.174 and every release below 4.2.67 can execute attacker-controlled JavaScript while opening a malicious PDF whenever `isEvalSupported` is true (the pdf.js default); upstream removed the `eval` path in 4.2.67. 5.x/6.x are deliberately not used yet — they declare `engines.node >=22.13`, while `engines.vscode ^1.95.0` ships Electron 32 / Node 20.18.1 in the extension host, and 4.10.38 is the newest release that is both fixed and still runs there (`engines.node >=20`). 4.x is ESM-only, so there is no CommonJS build left to `require`: the legacy build is loaded through a real dynamic `import('pdfjs-dist/legacy/build/pdf.mjs')`, `GlobalWorkerOptions.workerSrc` is set to `pdfjs-dist/legacy/build/pdf.worker.mjs`, and the worker module is preloaded onto `globalThis.pdfjsWorker` so pdf.js reuses it directly instead of dynamically importing it itself (the bootstrap that used to fail in the host with “document is not defined” or a browser-like bare `TypeError`). Yisi additionally passes `isEvalSupported: false` on every `getDocument` call, so the disabled-eval control holds independently of the version. Used only for text-layer extraction (`page.getTextContent`) and for decoding embedded page rasters of scanned/image PDFs into PNGs (no rendering and no `canvas` dependency; page images are re-encoded by our pure-JS PNG writer using Node's built-in `zlib`). Covered by real-dependency tests in `test/pdf-real-extractor.test.js` (the other PDF tests use fakes). |
| mammoth | 1.12.2 | BSD-2-Clause | Extracts `.docx` text via `extractRawText({ buffer })`; document order preserves headings/paragraphs/lists/tables as plain text. |
| read-excel-file | 9.3.10 | MIT | Read-only `.xlsx` parser (`require('read-excel-file/node')`); worksheet/row counts are bounded before rendering. Replaces the previously considered `xlsx` (SheetJS), whose npm distribution carried known vulnerabilities. |
| jszip | 3.10.1 | MIT | Reads Office container central directories for `.docx`/`.pptx`/`.xlsx`; also drives the decompression-bomb guards (`zipSafety.ts`) before any entry is inflated. |

Rationale (dependency policy): `VS Code API > Node stdlib > lightweight pure
TS/JS package > larger pure-JS package`; native/`node-gyp`/C++/Rust/Python/
LibreOffice/system-OCR binaries are intentionally excluded. Legacy `.doc`,
`.odt`, `.rtf`, `.xls`, `.ods`, `.ppt`, `.odp` have no maintained, pure-JS,
safe reader in v0.1 and are rejected upstream rather than parsed with an
unsafe or unmaintained package.

