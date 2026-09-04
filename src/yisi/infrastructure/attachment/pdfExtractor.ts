// PDF text extractor. Uses pdfjs (Mozilla, Apache-2.0, pure JS) with an
// injectable module so tests never need a real PDF or a network fetch.
//
// Policy: text is extracted per page, capped by max pages (default 120) and by
// total characters. A PDF with almost no extractable text is reported honestly
// (likely scanned) instead of pretending to be empty-and-successful.

import { randomUUID } from 'node:crypto';
import { ATTACHMENT_LIMITS } from '../../context/attachment/attachmentTypes';
import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput
} from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}
export interface PdfPageLike {
  getTextContent(): Promise<{ items: Array<{ str: string; hasEOL?: boolean }> }>;
}
export interface PdfJsModule {
  getDocument(source: {
    data: Uint8Array;
    isEvalSupported: boolean;
    verbosity: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    useWorkerFetch?: boolean;
    isOffscreenCanvasSupported?: boolean;
    isImageDecoderSupported?: boolean;
    enableXfa?: boolean;
    stopAtErrors?: boolean;
  }): { promise: Promise<PdfDocumentLike> };
}

/** pdfjs-dist 4.x is ESM-only, so the module is injected as an async loader. */
export type PdfJsLoader = () => Promise<PdfJsModule>;

const SCANNED_TEXT_THRESHOLD = 12;

/** Maps a pdfjs open failure to a concise, user-readable message. Relies on the
 * exception `name` first (pdfjs uses stable class names), then falls back to
 * keyword matching on `message` for versions that localize or rename them. */
function pdfOpenErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message ?? '' : '';
  switch (name) {
    case 'PasswordException':
      return 'This PDF is password-protected. Password-protected PDFs are not supported yet.';
    case 'InvalidPDFException':
      return 'This PDF appears to be invalid or corrupted.';
    case 'MissingPDFException':
      return 'This PDF data could not be found.';
    case 'UnexpectedResponseException':
      return 'This PDF could not be loaded.';
    default:
      break;
  }
  const lower = message.toLowerCase();
  if (lower.includes('password')) {
    return 'This PDF is password-protected. Password-protected PDFs are not supported yet.';
  }
  if (lower.includes('invalid') || lower.includes('corrupt')) {
    return 'This PDF appears to be invalid or corrupted.';
  }
  if (lower.includes('missing')) {
    return 'This PDF data could not be found.';
  }
  if (lower.includes('worker') || lower.includes('dommatrix') || lower.includes('canvas')) {
    const detail = safeDiagnostic(message);
    return detail
      ? `The PDF parser could not initialize correctly in the VS Code extension host (${detail}).`
      : 'The PDF parser could not initialize correctly in the VS Code extension host.';
  }
  if (name === 'UnknownErrorException' && message.trim()) {
    return `Failed to parse this PDF (${safeDiagnostic(message)}).`;
  }
  return name ? `Failed to parse this PDF (${name}).` : 'Failed to parse this PDF.';
}

function safeDiagnostic(message: string): string {
  const normalized = message.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}

export class PdfExtractor implements AttachmentExtractor {
  readonly id = 'pdf';

  constructor(private readonly loadPdfJs: PdfJsLoader) {}

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'pdf';
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    let document: PdfDocumentLike | undefined;
    try {
      const pdfjs = await this.loadPdfJs();
      // isEvalSupported:false forbids PDF JavaScript / dynamic code execution;
      // verbosity:0 keeps Node font/warning noise out of the extension host.
      document = await pdfjs.getDocument({
        data: new Uint8Array(input.bytes),
        isEvalSupported: false,
        // Yisi only needs the text layer. Explicitly disable rendering-oriented
        // browser features so PDF.js does not depend on Canvas/DOM polyfills in
        // the VS Code Extension Host.
        disableFontFace: true,
        useSystemFonts: true,
        useWorkerFetch: false,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
        enableXfa: false,
        stopAtErrors: false,
        verbosity: 0
      }).promise;
    } catch (error) {
      // Distinguish why the PDF failed to open so the composer can name the real
      // cause instead of one catch-all message. The raw name/message is kept for
      // diagnostics only; it never carries PDF text, keys, or secrets.
      console.warn(`[Yisi AI] PDF open failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`);
      throw new AttachmentExtractionError(pdfOpenErrorMessage(error), { cause: error });
    }
    try {
      const maxPages = ATTACHMENT_LIMITS.maxPdfPages;
      const pages = Math.min(document.numPages, maxPages);
      const parts: string[] = [];
      const chunks = [];
      let chars = 0;
      let truncated = false;
      let stop = false;

      for (let pageNumber = 1; pageNumber <= pages && !stop; pageNumber += 1) {
        options.signal?.throwIfAborted();
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = '';
        for (const item of content.items) {
          pageText += item.str;
          pageText += item.hasEOL ? '\n' : ' ';
        }
        pageText = pageText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (chars + pageText.length + 16 > options.maxChars) {
          truncated = true;
          stop = true;
          break;
        }
        const block = `Page ${pageNumber}:\n${pageText}`;
        parts.push(block);
        chunks.push({ id: randomUUID(), text: block, page: pageNumber });
        chars += pageText.length;
      }

      if (document.numPages > pages) truncated = true;
      const text = parts.join('\n\n');
      const warnings: string[] = [];
      if (chars < SCANNED_TEXT_THRESHOLD) {
        warnings.push('This PDF contains little or no extractable text.');
        warnings.push('Scanned PDF OCR is not supported yet.');
      }
      if (truncated) {
        warnings.push(`Large PDF attached. Only the first ${pages} pages / first portion is included in v0.1.`);
      }
      return {
        kind: input.kind,
        text,
        chunks,
        metadata: { pages: document.numPages },
        truncated,
        warnings
      };
    } catch (error) {
      if (error instanceof AttachmentExtractionError) throw error;
      throw new AttachmentExtractionError('PDF text extraction failed.', { cause: error });
    } finally {
      await document.destroy().catch(() => undefined);
    }
  }
}
