// Shared text helpers for attachment extractors. Extractor libraries stay free
// of these so they can be replaced independently.

import { AttachmentExtractionError } from './attachmentErrors';

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
}

/** Strict-ish decode: UTF-8 first, UTF-16 via BOM, then a clear failure. */
export function decodeAttachmentText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch (error) {
    throw new AttachmentExtractionError(
      'This file does not use a supported text encoding (UTF-8 / UTF-16 with BOM).',
      { cause: error }
    );
  }
}

/** Cap a string to maxChars at a line boundary; returns whether it was cut. */
export function truncateToChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  let end = maxChars;
  while (end > 0 && text[end - 1] !== '\n') end -= 1;
  if (end === 0) end = maxChars;
  return { text: text.slice(0, end), truncated: true };
}

/** Count 1-based line numbers inside `text` for metadata (not line-aware parse). */
export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

export interface LineChunk {
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Split text into line-aligned chunks of roughly `maxCharsPerChunk` so a large
 * code/text file becomes multiple source-labelled chunks instead of one giant
 * blob that a context budget cannot partially trim.
 */
export function chunkByLines(text: string, maxCharsPerChunk = 4_000): LineChunk[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  const chunks: LineChunk[] = [];
  let startLine = 1;
  let buffer: string[] = [];
  let chars = 0;
  for (let index = 0; index < lines.length; index += 1) {
    buffer.push(lines[index]);
    chars += lines[index].length + 1;
    if (chars >= maxCharsPerChunk || index === lines.length - 1) {
      chunks.push({ text: buffer.join('\n'), startLine, endLine: index + 1 });
      startLine = index + 2;
      buffer = [];
      chars = 0;
    }
  }
  return chunks;
}
