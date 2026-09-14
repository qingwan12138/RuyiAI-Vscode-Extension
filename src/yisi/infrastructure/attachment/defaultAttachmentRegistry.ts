// Production wiring of the attachment extractor registry. Each library-backed
// extractor receives its real module here, lazily required/imported on first use
// so a heavy parser (pdfjs especially) is never loaded during extension
// activation. Tests build their own registry with in-memory fakes instead of
// using this.

import { AttachmentExtractorRegistry } from './attachmentExtractor';
import { DelimitedSpreadsheetExtractor } from './delimitedSpreadsheetExtractor';
import { DocxExtractor, MammothModule } from './docxExtractor';
import { ImageExtractor } from './imageExtractor';
import { NotebookExtractor } from './notebookExtractor';
import { PdfExtractor, PdfJsModule } from './pdfExtractor';
import { PptxExtractor } from './pptxExtractor';
import { ReadXlsxFile, SpreadsheetExtractor } from './spreadsheetExtractor';
import { TextExtractor } from './textExtractor';
import { ZipLoader } from './zipSafety';

function cached<T>(id: string): () => T {
  let value: T | undefined;
  return () => {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- lazy loader
      value = require(id) as T;
    }
    return value;
  };
}

// pdfjs-dist is pinned to the 4.x line: 3.11.174 (the last CommonJS build) is
// affected by CVE-2024-4367 / GHSA-wgrm-67xf-hhpq, where opening a malicious PDF
// executes attacker-controlled JavaScript unless `isEvalSupported` is false. The
// `eval` path was removed in 4.2.67. The 5.x/6.x lines are deliberately not used
// yet: they declare `engines.node >=22.13`, while the declared baseline
// `engines.vscode ^1.95.0` ships Electron 32 / Node 20.18.1 in the extension
// host. 4.10.38 is the newest release that both contains the fix and still runs
// on the supported host (it declares `engines.node >=20`).
//
// 4.x is ESM-only, so there is no CommonJS build left to `require`: the legacy
// build has to come in through a real dynamic `import()`. The specifiers are
// held in `string` variables on purpose — TypeScript then leaves the dynamic
// import alone instead of downlevelling it to `require()`, and it will not try
// to resolve a `.mjs` type surface we do not depend on. (`module: Node16` in
// tsconfig also preserves it; see the dist inspection in docs/22.)
//
// Two extension-host quirks are patched before first use, exactly as the old
// CommonJS build needed:
//  * pdf.js needs an explicit worker path, else it throws
//    "No 'GlobalWorkerOptions.workerSrc' specified." → workerSrc points at the
//    legacy ESM worker.
//  * its fake-worker bootstrap either has to dynamically `import()` the worker
//    itself (which trips "document is not defined" in the host) or, if a
//    `document` shim is present, fails into a browser-like code path (bare
//    TypeError while reading pages). Instead we preload the worker module onto
//    `globalThis.pdfjsWorker` so pdf.js reuses it directly and never needs the
//    DOM shims at all.
const PDFJS_MAIN_SPECIFIER: string = 'pdfjs-dist/legacy/build/pdf.mjs';
const PDFJS_WORKER_SPECIFIER: string = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

function cachedPdfJs(): () => Promise<PdfJsModule> {
  let modulePromise: Promise<PdfJsModule> | undefined;
  return () => {
    modulePromise ??= (async () => {
      const pdfjs = (await import(PDFJS_MAIN_SPECIFIER)) as unknown as PdfJsModule &
        { GlobalWorkerOptions?: { workerSrc?: string } };
      try {
        if (pdfjs.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(PDFJS_WORKER_SPECIFIER);
        }
        const scope = globalThis as Record<string, unknown>;
        if (scope.pdfjsWorker === undefined) {
          scope.pdfjsWorker = await import(PDFJS_WORKER_SPECIFIER);
        }
      } catch {
        // Worker preload/path resolution is best-effort; pdf.js falls back.
      }
      return pdfjs;
    })();
    return modulePromise;
  };
}

export function createDefaultAttachmentRegistry(): AttachmentExtractorRegistry {
  const pdfjs = cachedPdfJs();
  const mammoth = cached<MammothModule>('mammoth');
  const readXlsxFile = cached<ReadXlsxFile>('read-excel-file/node');
  const jszip = cached<ZipLoader>('jszip');
  const zipLoader: ZipLoader = { loadAsync: data => jszip().loadAsync(data) };

  return new AttachmentExtractorRegistry()
    .register(new TextExtractor())
    .register(new NotebookExtractor())
    .register(new DelimitedSpreadsheetExtractor())
    .register(new PdfExtractor(() => pdfjs()))
    .register(new DocxExtractor({ extractRawText: input => mammoth().extractRawText(input) }, zipLoader))
    .register(new SpreadsheetExtractor(data => readXlsxFile()(data), zipLoader))
    .register(new PptxExtractor(zipLoader))
    .register(new ImageExtractor());
}
