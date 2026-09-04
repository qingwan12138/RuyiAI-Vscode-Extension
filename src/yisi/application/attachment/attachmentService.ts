// AttachmentService (application layer): turns raw file bytes selected by the
// composer into per-attachment outcomes. Each file is classified (extension +
// magic bytes), handed to a matching extractor under a hard character budget,
// and reported as a view model the UI renders as a chip. Failures are isolated
// per file and reported on the chip — never as the generic session error.
//
// Layering: this module owns no file I/O. The caller supplies already-bounded
// bytes (capped to ATTACHMENT_LIMITS.maxReadBytes) plus a vision probe used only
// when an image is attached. Webviews never parse files; they only receive views.

import { randomUUID } from 'node:crypto';
import { AttachmentLocation, FileContextReference } from '../../domain/session';
import { AttachmentExtractionError } from '../../context/attachment/attachmentErrors';
import {
  AttachmentContext,
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput,
  AttachmentImagePayload,
  AttachmentKind,
  AttachmentStatus,
  ATTACHMENT_LIMITS,
  maxFileBytesForKind
} from '../../context/attachment/attachmentTypes';
import { detectAttachmentKind } from '../../context/attachment/attachmentKind';
import { AttachmentExtractorRegistry } from '../../infrastructure/attachment/attachmentExtractor';

export interface AttachmentCandidate {
  /** Basename shown on the chip and used for extension-based detection. */
  name: string;
  /** Workspace-relative POSIX path (workspace files) or absolute path (external files). */
  relativePath: string;
  /** Lower-cased extension without the leading dot (derived when omitted). */
  extension?: string;
  /** Present for workspace files; absent for external files. */
  workspaceFolderUri?: string;
  /** 'workspace' (default) or 'external'. External files are read-only context. */
  location?: AttachmentLocation;
  /** Absolute file:// URI for external files. */
  uri?: string;
  /** Full file bytes, already capped by the caller to ATTACHMENT_LIMITS.maxReadBytes. */
  bytes: Uint8Array;
}

export interface AttachedFileView {
  id: string;
  name: string;
  relativePath: string;
  workspaceFolderUri?: string;
  /** 'workspace' or 'external'. External files are read-only and shown as such. */
  location: AttachmentLocation;
  /** Absolute file:// URI for external files. */
  uri?: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  /** Human-readable chip message for warning/unsupported/error outcomes. */
  message?: string;
  /** Reported file size in bytes. */
  bytes: number;
}

export interface AttachmentOutcome {
  view: AttachedFileView;
  /** Present only when the attachment is sendable as model context. */
  context?: { reference: FileContextReference; attachment: AttachmentContext };
}

/**
 * Two-layer vision gate: the active model must advertise image input AND the
 * provider transport must be able to carry image content. v0.1 implements no
 * image transport, so `transportSupported` is false for every provider; the
 * field exists so the service reports the correct layer once transport lands.
 */
export interface VisionCapability {
  modelSupported: boolean;
  transportSupported: boolean;
}

/** Lets the service ask whether the active model + transport can consume images. */
export interface AttachmentVisionProbe {
  getVisionCapability(): Promise<VisionCapability>;
}

/** Runtime-tunable attachment options (resolved per attach by the host). */
export interface AttachmentServiceOptions {
  /**
   * How many scanned/image PDF pages to attach as images (0 = whole document,
   * bounded by the extractor's hard ceiling). Defaults to 0 (all pages).
   */
  getPdfVisionPagesLimit?: () => number;
}

/**
 * Re-reads a previously attached file by its persisted session reference so
 * attachments stay referenceable across turns. Implemented in the vscode layer
 * (the application layer owns no file I/O). Returns undefined when the file can
 * no longer be read — a silent, per-file failure that never surfaces as the
 * session error.
 */
export interface AttachmentRehydrator {
  rehydrate(reference: FileContextReference, signal?: AbortSignal): Promise<AttachmentContext | undefined>;
}

export const NO_VISION_MESSAGE = 'The current model does not support image input. Choose a vision-capable model to use this attachment.';
export const NO_IMAGE_TRANSPORT_MESSAGE = 'Image input is not supported by the current Yisi provider transport yet.';

const UNSUPPORTED_BINARY_MESSAGE = 'This binary file type cannot be attached as normal context.';

export class AttachmentService {
  constructor(
    private readonly extractors: AttachmentExtractorRegistry,
    private readonly visionProbe?: AttachmentVisionProbe,
    private readonly options: AttachmentServiceOptions = {}
  ) {}

  async attachMany(candidates: AttachmentCandidate[], signal?: AbortSignal): Promise<AttachmentOutcome[]> {
    const outcomes: AttachmentOutcome[] = [];
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      outcomes.push(await this.attachOne(candidate));
    }
    return outcomes;
  }

  /** Per-file failure outcome for cases that happen before classification (e.g.
   * the file is larger than the attachment limit or unreadable). Kept here so
   * the caller never fabricates views itself. */
  createFailure(
    candidate: { name: string; relativePath: string; workspaceFolderUri?: string; location?: AttachmentLocation; uri?: string },
    message: string,
    kind: AttachmentKind = 'unsupported'
  ): AttachmentOutcome {
    return {
      view: {
        id: randomUUID(),
        name: candidate.name,
        relativePath: candidate.relativePath,
        workspaceFolderUri: candidate.workspaceFolderUri,
        location: candidate.location ?? 'workspace',
        uri: candidate.uri,
        kind,
        status: 'error',
        message,
        bytes: 0
      }
    };
  }

  async attachOne(candidate: AttachmentCandidate): Promise<AttachmentOutcome> {
    const head = candidate.bytes.subarray(0, ATTACHMENT_LIMITS.sniffBytes);
    const extension = lowerExtension(candidate);
    const guess = detectAttachmentKind(candidate.name, head, candidate.bytes);
    const location = candidate.location ?? 'workspace';

    const baseView = (kind: AttachmentKind, status: AttachmentStatus, message?: string): AttachedFileView => ({
      id: randomUUID(),
      name: candidate.name,
      relativePath: candidate.relativePath,
      workspaceFolderUri: candidate.workspaceFolderUri,
      location,
      uri: candidate.uri,
      kind,
      status,
      message,
      bytes: candidate.bytes.byteLength
    });

    // Never-attachable kinds are reported first so their message wins over a
    // size error. The size check then runs against the detected kind (not a
    // hardcoded "unsupported"), so an oversized PDF/PPTX is labelled PDF/PPTX
    // rather than a generic BIN.
    if (guess.kind === 'archive' || extension === 'jar' || extension === 'apk') {
      return { view: baseView('archive', 'unsupported', 'Archive and package files cannot be attached as normal context yet.') };
    }

    if (guess.kind === 'unsupported') {
      return { view: baseView('unsupported', 'unsupported', UNSUPPORTED_BINARY_MESSAGE) };
    }

    const kindLimit = maxFileBytesForKind(guess.kind);
    if (candidate.bytes.byteLength > kindLimit) {
      return { view: baseView(guess.kind, 'error', `This file is too large to attach (limit ${formatBytes(kindLimit)}).`) };
    }

    if (guess.kind === 'image') {
      const capability = await this.visionCapability();
      if (!capability.modelSupported) {
        return { view: baseView('image', 'warning', NO_VISION_MESSAGE) };
      }
      if (!capability.transportSupported) {
        return { view: baseView('image', 'warning', NO_IMAGE_TRANSPORT_MESSAGE) };
      }
    }

    const capability = await this.visionCapability();
    const input: AttachmentFileInput = {
      name: candidate.name,
      relativePath: candidate.relativePath,
      extension,
      sizeBytes: candidate.bytes.byteLength,
      bytes: candidate.bytes,
      head,
      kind: guess.kind
    };
    if (!this.extractors.pick(input)) {
      return { view: baseView(guess.kind, 'unsupported', unsupportedFormatMessage(guess.kind, extension)) };
    }

    const options: AttachmentExtractOptions = {
      maxChars: ATTACHMENT_LIMITS.maxExtractedChars,
      // Scanned/image-only PDFs become page images only when the whole vision
      // chain (model + provider transport) can carry them.
      imagesForVision: guess.kind === 'pdf'
        && capability.modelSupported
        && capability.transportSupported,
      // 0 = whole document (extractor still enforces its hard ceiling).
      pdfVisionPages: this.options.getPdfVisionPagesLimit?.() ?? 0
    };

    let result: AttachmentExtractionResult;
    try {
      result = await this.extractors.extract(input, options);
    } catch (error) {
      const message = error instanceof AttachmentExtractionError
        ? error.message
        : `This ${kindLabel(guess.kind)} file could not be read as context.`;
      return { view: baseView(guess.kind, 'error', `Failed to attach: ${message}`) };
    }

    const rawImages = collectResultImages(result);
    const isPdfPages = guess.kind === 'pdf';
    const capableForVision = capability.modelSupported && capability.transportSupported;
    // Never trust an extractor to return images when the session cannot carry
    // them: for PDF page images the vision gate is decided here. Regular image
    // attachments were already gated earlier, so they pass straight through.
    const deliveredImages = isPdfPages && !capableForVision ? [] : rawImages;
    let warnings = [...(result.warnings ?? [])];
    if (isPdfPages && deliveredImages.length > 0) {
      // Page images carry the content for vision models; the "scanned/OCR"
      // text warnings would be misleading once images are actually attached.
      warnings = warnings.filter(warning =>
        !/little or no extractable text|Scanned PDF OCR is not supported/i.test(warning)
      );
      if (result.text.trim().length === 0) {
        warnings.push('Scanned PDF pages attached as images for the vision model.');
      }
    } else if (isPdfPages && rawImages.length > 0) {
      // Image pages exist but the model/transport cannot consume them.
      warnings.push('This PDF has image-only pages, but the current model or provider cannot receive image input. Switch to a vision-capable model to read them.');
    }

    const status: AttachmentStatus = warnings.length > 0 ? 'warning' : 'ready';
    const view = baseView(result.kind, status, warnings[0]);
    const contextImages = deliveredImages;
    return {
      view,
      context: {
        reference: buildReference(candidate, location),
        attachment: {
          id: view.id,
          fileName: candidate.name,
          kind: result.kind,
          chunks: result.chunks ?? [],
          metadata: result.metadata,
          truncated: result.truncated ?? false,
          warnings,
          ...(contextImages.length > 0
            ? { image: contextImages[0], images: contextImages }
            : {})
        }
      }
    };
  }

  private async visionCapability(): Promise<VisionCapability> {
    if (!this.visionProbe) return { modelSupported: false, transportSupported: false };
    try {
      return await this.visionProbe.getVisionCapability();
    } catch {
      return { modelSupported: false, transportSupported: false };
    }
  }
}

function buildReference(candidate: AttachmentCandidate, location: AttachmentLocation): FileContextReference {
  const reference: FileContextReference = {
    type: 'file',
    path: candidate.relativePath,
    location
  };
  if (candidate.workspaceFolderUri !== undefined) reference.workspaceFolderUri = candidate.workspaceFolderUri;
  if (candidate.uri !== undefined) reference.uri = candidate.uri;
  return reference;
}

function lowerExtension(candidate: AttachmentCandidate): string | undefined {
  if (candidate.extension) return candidate.extension.toLowerCase();
  const base = (candidate.name.split('/').pop() ?? candidate.name);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1).toLowerCase();
}

function collectResultImages(result: AttachmentExtractionResult): AttachmentImagePayload[] {
  if (result.images && result.images.length > 0) return result.images;
  return result.image ? [result.image] : [];
}

function kindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case 'pdf': return 'PDF';
    case 'document': return 'document';
    case 'presentation': return 'presentation';
    case 'spreadsheet': return 'spreadsheet';
    case 'notebook': return 'notebook';
    case 'markdown': return 'Markdown';
    default: return 'text';
  }
}

function unsupportedFormatMessage(kind: AttachmentKind, extension: string | undefined): string {
  switch (kind) {
    case 'document':
      return 'Only .docx documents are supported in v0.1 (this legacy format is not yet readable).';
    case 'presentation':
      return 'Only .pptx presentations are supported in v0.1 (this legacy format is not yet readable).';
    case 'spreadsheet':
      return 'Only .xlsx/.csv/.tsv spreadsheets are supported in v0.1.';
    case 'pdf':
      return 'Only PDF files are supported in v0.1.';
    case 'notebook':
      return 'Only .ipynb notebooks are supported in v0.1.';
    default:
      return 'This file format is not supported as context in v0.1 yet.';
  }
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
