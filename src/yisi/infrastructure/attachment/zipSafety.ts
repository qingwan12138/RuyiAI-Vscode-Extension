// ZIP / OOXML safety guards. Every Office container (docx/pptx/xlsx) is a ZIP
// archive that can be a decompression bomb: a small compressed file that expands
// to gigabytes and OOMs the Extension Host. Extractors that inflate a container
// must run these guards first. Directory entries report no sizes and are skipped.
//
// jszip is the single shared container reader here; its `loadAsync` reads only
// the central directory (entry metadata) without inflating any entry, so the
// guard is cheap relative to the actual parse.

import { AttachmentExtractionError } from './attachmentErrors';

export interface ZipEntryLike {
  async(type: 'string'): Promise<string>;
  _data?: { uncompressedSize?: number; compressedSize?: number };
}

export interface ZipArchiveLike {
  files: Record<string, ZipEntryLike>;
}

export interface ZipLoader {
  loadAsync(data: Uint8Array | ArrayBuffer): Promise<ZipArchiveLike>;
}

export interface ZipSafetyLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxSingleEntryBytes: number;
  maxCompressionRatio: number;
}

export const ZIP_SAFETY_LIMITS: ZipSafetyLimits = Object.freeze({
  maxEntries: 2_000,
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxSingleEntryBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200
});

export function assertZipSafe(archive: ZipArchiveLike, limits: ZipSafetyLimits = ZIP_SAFETY_LIMITS): void {
  const entries = Object.values(archive.files ?? {});
  if (entries.length > limits.maxEntries) {
    throw new AttachmentExtractionError('This file contains too many compressed entries to read safely.');
  }
  let totalUncompressed = 0;
  for (const entry of entries) {
    const uncompressed = Number(entry._data?.uncompressedSize ?? 0);
    const compressed = Number(entry._data?.compressedSize ?? 0);
    if (uncompressed > limits.maxSingleEntryBytes) {
      throw new AttachmentExtractionError('A compressed entry in this file is too large to read safely.');
    }
    totalUncompressed += uncompressed;
    if (compressed > 0 && uncompressed / compressed > limits.maxCompressionRatio) {
      throw new AttachmentExtractionError('This file has an unsafe compression ratio and was rejected.');
    }
  }
  if (totalUncompressed > limits.maxUncompressedBytes) {
    throw new AttachmentExtractionError('This file expands too large to read safely.');
  }
}

/**
 * Load a container's central directory and enforce the safety limits. When the
 * bytes are not a ZIP at all the error is swallowed so the real extractor can
 * report its own, more precise failure; only genuine safety violations throw.
 */
export async function assertZipBytesSafe(
  loader: ZipLoader,
  bytes: Uint8Array,
  limits: ZipSafetyLimits = ZIP_SAFETY_LIMITS
): Promise<void> {
  let archive: ZipArchiveLike;
  try {
    archive = await loader.loadAsync(bytes);
  } catch {
    return;
  }
  assertZipSafe(archive, limits);
}
