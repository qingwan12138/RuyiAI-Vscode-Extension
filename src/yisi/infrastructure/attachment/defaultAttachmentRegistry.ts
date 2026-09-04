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

// pdfjs-dist 4.x is ESM-only and cannot be `require`d from a CommonJS build, so
// its dynamic `import()` + fake-worker bootstrap fails inside the Electron
// extension host ("The PDF parser could not initialize correctly..."). We pin
// the 3.x legacy UMD build instead: it is CommonJS (`require`) loadable, works
// in the extension host, and its text-layer API is identical for our use.
//
// Two host quirks are patched before first use:
//  * pdf.js needs an explicit worker path, else it throws
//    "No 'GlobalWorkerOptions.workerSrc' specified." → we point workerSrc at
//    the legacy CJS worker.
//  * its fake-worker bootstrap touches the browser global `document` (and
//    sometimes `navigator`), which do not exist in the extension host, causing
//    "Setting up fake worker failed: \"document is not defined\"." → we install
//    tiny placeholder shims so the host proceeds; real browser globals are left
//    untouched.
function cachedPdfJs(): () => Promise<PdfJsModule> {
  let modulePromise: Promise<PdfJsModule> | undefined;
  return () => {
    modulePromise ??= Promise.resolve().then(() => {
      shimBrowserGlobalsForPdfJs();
      const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as PdfJsModule &
        { GlobalWorkerOptions?: { workerSrc?: string } };
      try {
        if (pdfjs.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
        }
      } catch {
        // Worker path resolution is best-effort; pdf.js falls back to auto.
      }
      return pdfjs;
    });
    return modulePromise;
  };
}

/** Minimal placeholder shims so pdf.js worker bootstrap can run in the host. */
function shimBrowserGlobalsForPdfJs(): void {
  const scope = globalThis as Record<string, unknown>;
  if (scope.document === undefined) {
    scope.document = {
      createElement: () => ({ getContext: () => null, style: {}, setAttribute: () => undefined }),
      createElementNS: () => ({ setAttribute: () => undefined }),
      documentElement: { style: {} }
    };
  }
  if (scope.navigator === undefined) {
    scope.navigator = { userAgent: 'node', platform: 'node' };
  }
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
