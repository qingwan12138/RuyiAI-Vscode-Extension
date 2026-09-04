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
| pdfjs-dist | 3.11.174 | Apache-2.0 | Mozilla PDF.js. Loaded as CommonJS legacy (`require('pdfjs-dist/legacy/build/pdf.js')`) so it works inside the Electron extension host (the 4.x ESM build fails with “PDF parser could not initialize correctly…”), `GlobalWorkerOptions.workerSrc` is set to `pdfjs-dist/legacy/build/pdf.worker.js`, and the worker module is preloaded onto `globalThis.pdfjsWorker` so pdf.js reuses it directly instead of dynamically importing it (which trips “document is not defined”, or a browser-like bare `TypeError`, in the host). Used only for text-layer extraction (`getDocument({ data, isEvalSupported: false, verbosity: 0 })` → `page.getTextContent`) and for decoding embedded page rasters of scanned/image PDFs into PNGs (no rendering and no `canvas` dependency; page images are re-encoded by our pure-JS PNG writer using Node's built-in `zlib`). DOMMatrix/Path2D polyfill warnings are harmless and expected. |
| mammoth | 1.12.2 | BSD-2-Clause | Extracts `.docx` text via `extractRawText({ buffer })`; document order preserves headings/paragraphs/lists/tables as plain text. |
| read-excel-file | 9.3.10 | MIT | Read-only `.xlsx` parser (`require('read-excel-file/node')`); worksheet/row counts are bounded before rendering. Replaces the previously considered `xlsx` (SheetJS), whose npm distribution carried known vulnerabilities. |
| jszip | 3.10.1 | MIT | Reads Office container central directories for `.docx`/`.pptx`/`.xlsx`; also drives the decompression-bomb guards (`zipSafety.ts`) before any entry is inflated. |
| gpt-tokenizer | 4.0.0 | MIT | Pure-JS Byte Pair Encoder for OpenAI model families (`o200k_base`/`cl100k_base`). Used only to count tokens for the composer context-usage ring; the raw text is never sent to this library's authors and inference is fully local. Non-OpenAI models (DeepSeek/Qwen/Llama/Claude) fall back to a bilingual heuristic (`contextUsage.estimateTokens`). |

Rationale (dependency policy): `VS Code API > Node stdlib > lightweight pure
TS/JS package > larger pure-JS package`; native/`node-gyp`/C++/Rust/Python/
LibreOffice/system-OCR binaries are intentionally excluded. Legacy `.doc`,
`.odt`, `.rtf`, `.xls`, `.ods`, `.ppt`, `.odp` have no maintained, pure-JS,
safe reader in v0.1 and are rejected upstream rather than parsed with an
unsafe or unmaintained package.

