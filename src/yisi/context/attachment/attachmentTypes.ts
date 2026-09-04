// Attachment / Context domain types for the Yisi AI attachment system.
//
// A file the user explicitly attaches is classified into an AttachmentKind and
// handed to a specialized extractor. Extractors never return raw binary to the
// model: they produce structured text (optionally chunked), metadata, warnings,
// and a truncation flag. All budget numbers live here so they are not scattered
// across the code base.

export type AttachmentKind =
  | 'text'
  | 'code'
  | 'markdown'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'notebook'
  | 'image'
  | 'archive'
  | 'unsupported';

// A single mutable attachment shown in the composer and resolved once at attach
// time (snapshot semantics: changes to the file after attach are ignored unless
// the file is re-attached).
export type AttachmentStatus = 'loading' | 'ready' | 'warning' | 'unsupported' | 'error';

export interface AttachmentFileInfo {
  /** Basename of the attached file (display name). */
  name: string;
  /** Workspace-relative POSIX path used as the persisted context reference. */
  relativePath: string;
  /** Lower-cased extension without the leading dot, when one exists. */
  extension?: string;
  /** Size in bytes reported by the file system. */
  sizeBytes: number;
}

/** Raw bounded file handed to the extractors by the reader port. */
export interface AttachmentFileInput extends AttachmentFileInfo {
  /** Full file bytes, already capped by the reader to ATTACHMENT_LIMITS.maxReadBytes. */
  bytes: Uint8Array;
  /** Leading sniff window used for magic-byte detection (<= ATTACHMENT_LIMITS.sniffBytes). */
  head: Uint8Array;
  /** Detected kind, filled in by the attachment service before extraction. */
  kind: AttachmentKind;
}

export interface AttachmentExtractOptions {
  /** Hard ceiling on extracted text characters; extractors truncate, never exceed. */
  maxChars: number;
  signal?: AbortSignal;
  /** PDF: also collect page images (scanned/image-only pages) for vision models. */
  imagesForVision?: boolean;
}

export interface AttachmentChunk {
  id: string;
  text: string;
  page?: number;
  slide?: number;
  sheet?: string;
  cellRange?: string;
  startLine?: number;
  endLine?: number;
}


export type AttachmentImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface AttachmentImagePayload {
  mimeType: AttachmentImageMimeType;
  dataBase64: string;
  /** Optional per-image display name (e.g. "report-p2.png"). */
  fileName?: string;
}

export interface AttachmentImageMeta {
  width?: number;
  height?: number;
  format?: string;
}

export interface AttachmentMetadata {
  pages?: number;
  slides?: number;
  sheets?: string[];
  cells?: number;
  notebooks?: { markdown: number; code: number };
  image?: AttachmentImageMeta;
}

export interface AttachmentExtractionResult {
  kind: AttachmentKind;
  /** Rendered text ready to be placed in model context (already truncated). */
  text: string;
  chunks?: AttachmentChunk[];
  metadata?: AttachmentMetadata;
  truncated?: boolean;
  warnings: string[];
  /** In-memory image payload for multimodal transports; never persisted in Session JSON. */
  image?: AttachmentImagePayload;
  /** Multiple in-memory images (e.g. scanned PDF pages) for vision models. */
  images?: AttachmentImagePayload[];
}

/**
 * Structured attachment payload that travels from the extractor all the way to
 * the model prompt. Unlike a single flattened string, it preserves per-chunk
 * provenance (page / slide / sheet / line range) and the truncation flag so the
 * model and the composer both know the attachment is (or is not) complete.
 */
export interface AttachmentContext {
  id: string;
  fileName: string;
  kind: AttachmentKind;
  chunks: AttachmentChunk[];
  metadata?: AttachmentMetadata;
  truncated: boolean;
  warnings: string[];
  /** In-memory only. Session history persists the file reference, not this base64 payload. */
  image?: AttachmentImagePayload;
  /** Multiple in-memory images (scanned PDF pages) for vision models. */
  images?: AttachmentImagePayload[];
}

// Central budget / guardrail configuration for the attachment pipeline.
export const ATTACHMENT_LIMITS = Object.freeze({
  /** Absolute ceiling on bytes the reader hands over before classification.
   * Per-kind ceilings (below) refine this after the kind is known. */
  maxReadBytes: 64 * 1024 * 1024,
  /** Default per-attachment ceiling for kinds without a specific limit. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Bytes read for magic-byte sniffing before a parser runs. */
  sniffBytes: 512,
  /** Hard ceiling on characters placed into model context for any one attachment. */
  maxExtractedChars: 150_000,
  /** PDF: extract at most this many pages. */
  maxPdfPages: 120,
  /** Spreadsheet: at most this many worksheets. */
  maxSheets: 5,
  /** Spreadsheet: at most this many data rows per worksheet. */
  maxSheetRows: 2_000,
  /** Notebook: at most this many cells. */
  maxNotebookCells: 300,
  /** Composer keeps at most this many pending attachments per session. */
  maxAttachmentsPerSession: 6,
  /** PDF-for-vision: at most this many pages become images. */
  maxPdfVisionPages: 4,
  /** PDF-for-vision: per-page pixel ceiling (area) after downscaling. */
  maxPdfVisionPixels: 1_600_000,
  /** PDF-for-vision: per-page encoded PNG byte ceiling. */
  maxPdfVisionImageBytes: 6 * 1024 * 1024
} as const);

/** Per-kind raw byte ceilings. Bulky binary containers (Office/PDF) get more
 * headroom than text; other kinds fall back to ATTACHMENT_LIMITS.maxFileBytes. */
export const MAX_FILE_BYTES_BY_KIND: Readonly<Partial<Record<AttachmentKind, number>>> = Object.freeze({
  pdf: 64 * 1024 * 1024,
  document: 32 * 1024 * 1024,
  presentation: 64 * 1024 * 1024,
  spreadsheet: 32 * 1024 * 1024,
  image: 12 * 1024 * 1024
});

export function maxFileBytesForKind(kind: AttachmentKind): number {
  return MAX_FILE_BYTES_BY_KIND[kind] ?? ATTACHMENT_LIMITS.maxFileBytes;
}
