// PDF text extractor (with optional page-image collection for vision models).
// Uses pdfjs (Mozilla, Apache-2.0, pure JS) with an injectable module so tests
// never need a real PDF or a network fetch.
//
// Policy: text is extracted per page, capped by max pages (default 120) and by
// total characters. A PDF with almost no extractable text is reported honestly
// (likely scanned) instead of pretending to be empty-and-successful.
//
// When the extractor is asked to collect images for vision
// (`options.imagesForVision`), scanned/image-only pages are decoded from their
// embedded raster (pdf.js) and re-encoded as bounded PNGs with no native deps.

import { randomUUID } from 'node:crypto';
import { ATTACHMENT_LIMITS } from '../../context/attachment/attachmentTypes';
import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput,
  AttachmentImagePayload
} from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';
import { downscaleRaster, encodePng, RasterImage } from './pdfImageEncoding';

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

function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message || '' };
  return { name: 'unknown', message: String(error) };
}

function pageFailureSummary(failures: Array<{ page: number; name: string; message: string }>): string {
  return failures.slice(0, 3).map(failure => {
    const detail = failure.message ? safeDiagnostic(failure.message) : '';
    return `p${failure.page}: ${failure.name}${detail ? ` ${detail}` : ''}`;
  }).join('; ');
}

/** pdf.js page object exposing the operator list + object store. */
interface PdfImageCapablePage {
  getOperatorList(): Promise<{ argsArray: unknown[][] }>;
  commonObjs?: PdfObjectStore;
  objs: PdfObjectStore;
}
interface PdfObjectStore {
  has(name: string): boolean;
  get(name: string): PdfDecodedImage | undefined;
}
interface PdfDecodedImage {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | null;
}
// pdf.js ImageKind enum (stable across 3.x): 2 = RGB, 3 = RGBA, 4 = gray8.
const IMAGE_KIND_RGB = 2;
const IMAGE_KIND_RGBA = 3;
const IMAGE_KIND_GRAY8 = 4;

/**
 * Decode the first usable embedded raster on a page (scanned pages carry one
 * large image). Returns undefined when the page has no decodable raster.
 */
async function collectPageRaster(page: PdfPageLike): Promise<RasterImage | undefined> {
  const capable = page as unknown as PdfImageCapablePage;
  if (typeof capable.getOperatorList !== 'function' || !capable.objs) return undefined;
  let operatorList: unknown;
  try {
    operatorList = await capable.getOperatorList();
  } catch {
    return undefined;
  }
  const argsArray = isRecord(operatorList) && Array.isArray(operatorList.argsArray)
    ? operatorList.argsArray as unknown[][]
    : [];
  const seen = new Set<string>();
  const candidates: RasterImage[] = [];
  for (const args of argsArray) {
    const name = Array.isArray(args) && typeof args[0] === 'string' ? args[0] : undefined;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const image = lookupImage(capable, name);
    if (!image || !image.width || !image.height || !image.data || image.data.length === 0) continue;
    const channels = channelsForImageKind(image.kind);
    if (channels === null) continue;
    if (image.width * image.height * channels > image.data.length) continue;
    candidates.push({
      data: toByteArray(image.data),
      width: image.width,
      height: image.height,
      channels
    });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => (right.width * right.height) - (left.width * left.height));
  return candidates[0];
}

function lookupImage(page: PdfImageCapablePage, name: string): PdfDecodedImage | undefined {
  try {
    if (page.commonObjs?.has(name)) return page.commonObjs.get(name);
  } catch {
    // ignore store access failures
  }
  try {
    if (page.objs.has(name)) return page.objs.get(name);
  } catch {
    // ignore store access failures
  }
  return undefined;
}

function channelsForImageKind(kind: number | undefined): 1 | 3 | 4 | null {
  if (kind === IMAGE_KIND_RGB) return 3;
  if (kind === IMAGE_KIND_RGBA) return 4;
  if (kind === IMAGE_KIND_GRAY8) return 1;
  return null;
}

function toByteArray(data: Uint8Array | Uint8ClampedArray): Uint8Array {
  if (data instanceof Uint8Array && !(data instanceof Uint8ClampedArray)) return data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** "dir/report.pdf" -> "report" (also tolerates trailing dots in names). */
function baseNameOf(fileName: string): string {
  const base = (fileName.split('/').pop() ?? fileName).trim();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pages to turn into images: option when set (>0), else the hard ceiling. */
function resolvePdfVisionPageLimit(options: AttachmentExtractOptions): number {
  const ceiling = ATTACHMENT_LIMITS.maxPdfVisionPages;
  const requested = typeof options.pdfVisionPages === 'number' && options.pdfVisionPages > 0
    ? Math.floor(options.pdfVisionPages)
    : ceiling;
  return Math.min(requested, ceiling);
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
      const pageFailures: Array<{ page: number; name: string; message: string }> = [];
      const capturedRasters: Array<{ page: number; raster: RasterImage }> = [];
      const visionPageLimit = resolvePdfVisionPageLimit(options);
      let chars = 0;
      let truncated = false;
      let stop = false;

      for (let pageNumber = 1; pageNumber <= pages && !stop; pageNumber += 1) {
        options.signal?.throwIfAborted();
        try {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          let pageText = '';
          for (const item of content.items) {
            // Some text items are marked-content markers without `str`/`hasEOL`;
            // treat them as empty so one odd item never kills the page.
            if (typeof item.str !== 'string') continue;
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
          if (options.imagesForVision && capturedRasters.length < visionPageLimit) {
            const raster = await collectPageRaster(page);
            if (raster) capturedRasters.push({ page: pageNumber, raster });
          }
        } catch (pageError) {
          // A single problematic page must not fail the whole attachment: note
          // it and continue so the remaining pages still become context. The
          // real error is surfaced on the chip/diagnostic for the next version
          // of this fix to target.
          console.warn(`[Yisi AI] PDF page ${pageNumber} failed: ${describeError(pageError)}`);
          pageFailures.push({ page: pageNumber, ...describeError(pageError) });
        }
      }

      if (document.numPages > pages) truncated = true;
      const text = parts.join('\n\n');
      const warnings: string[] = [];
      if (pageFailures.length > 0) {
        warnings.push(`PDF extraction skipped ${pageFailures.length} page(s) that could not be read (${pageFailureSummary(pageFailures)}).`);
      }
      if (chars < SCANNED_TEXT_THRESHOLD) {
        warnings.push('This PDF contains little or no extractable text.');
        warnings.push('Scanned PDF OCR is not supported yet.');
      }
      if (truncated) {
        warnings.push(`Large PDF attached. Only the first ${pages} pages / first portion is included in v0.1.`);
      }
      if (parts.length === 0 && pageFailures.length > 0) {
        // Every page failed: surface the first real cause instead of a bare name.
        const first = pageFailures[0];
        throw new AttachmentExtractionError(
          `Failed to parse this PDF (${first.name}${first.message ? `: ${safeDiagnostic(first.message)}` : ''}).`,
          { cause: first }
        );
      }

      // Scanned/image pages -> bounded PNG payloads for vision-capable models.
      const images: AttachmentImagePayload[] = [];
      if (options.imagesForVision && capturedRasters.length > 0) {
        const stem = baseNameOf(input.name);
        for (const entry of capturedRasters) {
          try {
            const bounded = downscaleRaster(entry.raster, ATTACHMENT_LIMITS.maxPdfVisionPixels);
            const png = encodePng(bounded);
            if (png.length > ATTACHMENT_LIMITS.maxPdfVisionImageBytes) {
              warnings.push(`PDF page ${entry.page} image was too large to attach as context.`);
              continue;
            }
            images.push({
              mimeType: 'image/png',
              dataBase64: Buffer.from(png).toString('base64'),
              fileName: `${stem}-p${entry.page}.png`
            });
          } catch (imageError) {
            console.warn(`[Yisi AI] PDF page ${entry.page} image encode failed: ${safeDiagnostic(
              imageError instanceof Error ? imageError.message : String(imageError)
            )}`);
          }
        }
      }
      return {
        kind: input.kind,
        text,
        chunks,
        metadata: { pages: document.numPages },
        truncated,
        warnings,
        ...(images.length > 0 ? { images } : {})
      };
    } catch (error) {
      if (error instanceof AttachmentExtractionError) throw error;
      throw new AttachmentExtractionError('PDF text extraction failed.', { cause: error });
    } finally {
      await document.destroy().catch(() => undefined);
    }
  }
}
