// Pure file-type detection for the attachment pipeline. Detection intentionally
// combines the file extension with the leading magic bytes so that a binary
// renamed to `*.txt` is still recognized as binary instead of being decoded as
// UTF-8 text. This module must stay dependency free so it is fully unit-testable.

import { AttachmentKind } from './attachmentTypes';

export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'log', 'rst',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf', 'properties',
  'html', 'htm', 'css', 'scss', 'less', 'sass', 'sql', 'graphql', 'gql', 'svg',
  'env', 'gitignore'
]);

export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown', 'mdx']);

export const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp',
  'rs', 'go', 'java', 'kt', 'kts', 'cs', 'swift', 'php', 'rb', 'sh', 'bash', 'zsh',
  'fish', 'ps1', 'bat', 'cmd', 'lua', 'scala', 'dart', 'vue', 'svelte', 'proto',
  'cmake', 'make', 'mk', 'gradle', 'rake', 'erl', 'ex', 'exs', 'fs', 'fsx', 'r',
  'pl', 'pm', 'nim', 'zig', 'tcl', 'sqlite', 'asm', 'S', 'cob', 'pas', 'm', 'mm',
  'pug', 'ejs', 'handlebars', 'hbs', 'mustache', 'twig', 'jinja', 'j2', 'tex'
]);

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico']);

export const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['doc', 'docx', 'odt', 'rtf']);

export const PRESENTATION_EXTENSIONS: ReadonlySet<string> = new Set(['ppt', 'pptx', 'odp']);

export const SPREADSHEET_EXTENSIONS: ReadonlySet<string> = new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods']);

export const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set(['zip', 'tar', 'gz', '7z', 'rar', 'xz', 'bz2']);

// Explicitly rejected binary / executable payloads that are never decoded as
// context text. Archives (zip/tar) are intentionally not opened in v0.1: only a
// dedicated archive-analysis tool may read them later.
export const BINARY_REJECTED_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'dll', 'so', 'dylib', 'o', 'a', 'lib', 'obj', 'bin', 'iso', 'img', 'dmg',
  'msi', 'class', 'jar', 'apk', 'wasm', 'pyc', 'pyd', 'node', 'elf', 'com', 'scr',
  'sys', 'vxd', 'ocx', 'drv'
]);

// Well-known text/code files that have no conventional extension (or only a
// leading-dot name). Matched on the lower-cased basename.
export const DOTLESS_TEXT_NAMES: ReadonlySet<string> = new Set([
  'dockerfile', 'makefile', 'cmakelists', 'justfile', 'rakefile', 'gemfile',
  'vagrantfile', 'procfile', 'bsconfig', 'flake.lock', 'package-lock',
  'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', '.gitignore', '.npmrc',
  '.bashrc', '.zshrc', '.bash_profile', '.profile', '.editorconfig',
  '.prettierrc', '.eslintrc', '.stylelintrc', 'license', 'readme'
]);

export interface AttachmentKindGuess {
  kind: AttachmentKind;
  extension?: string;
}

/**
 * Classify by extension + basename first. Returns undefined when the extension
 * is not recognized so the caller can fall back to magic bytes / content probes.
 */
export function classifyByExtension(name: string): AttachmentKindGuess | undefined {
  const base = (name.split('/').pop() ?? name).trim();
  const lower = base.toLowerCase();
  if (!lower) return undefined;

  if (DOTLESS_TEXT_NAMES.has(lower)) return { kind: 'text' };
  if (lower === 'license' || lower === 'license.md' || lower === 'copying') return { kind: 'text' };

  const dotIndex = lower.lastIndexOf('.');
  const extension = dotIndex >= 0 && dotIndex < lower.length - 1 ? lower.slice(dotIndex + 1) : undefined;
  if (!extension) return undefined;

  const normalized = extension.toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(normalized)) return { kind: 'markdown', extension: normalized };
  if (TEXT_EXTENSIONS.has(normalized)) return { kind: 'text', extension: normalized };
  if (CODE_EXTENSIONS.has(normalized)) return { kind: 'code', extension: normalized };
  if (normalized === 'pdf') return { kind: 'pdf', extension: normalized };
  if (DOCUMENT_EXTENSIONS.has(normalized)) return { kind: 'document', extension: normalized };
  if (PRESENTATION_EXTENSIONS.has(normalized)) return { kind: 'presentation', extension: normalized };
  if (SPREADSHEET_EXTENSIONS.has(normalized)) return { kind: 'spreadsheet', extension: normalized };
  if (normalized === 'ipynb') return { kind: 'notebook', extension: normalized };
  if (IMAGE_EXTENSIONS.has(normalized)) return { kind: 'image', extension: normalized };
  if (normalized === 'zip') return { kind: 'archive', extension: normalized };
  if (ARCHIVE_EXTENSIONS.has(normalized)) return { kind: 'archive', extension: normalized };
  if (BINARY_REJECTED_EXTENSIONS.has(normalized)) return { kind: 'unsupported', extension: normalized };
  return undefined;
}

/**
 * Content probes: magic bytes for container formats, then a text/binary check.
 * Text-like extensions already flow through this probe so a renamed binary is
 * still caught by {@link classifyContent}. `fullBytes` (when provided) is used
 * for the encoding-aware text/binary decision so a multi-byte UTF-8 character
 * is never judged from a truncated sniff window.
 */
export function classifyContent(name: string, head: Uint8Array, fullBytes?: Uint8Array): AttachmentKindGuess {
  const extension = extensionOf(name);
  if (head.length >= 5 && asciiStartsWith(head, '%PDF-')) return { kind: 'pdf', extension };
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) {
    // PK\x03\x04 = zip container. DOCX/XLSX/PPTX share the zip magic but are
    // already classified by their extension above; this fallback only matters
    // when the extension is missing/unknown.
    if (extension === 'docx') return { kind: 'document', extension };
    if (extension === 'xlsx') return { kind: 'spreadsheet', extension };
    if (extension === 'pptx') return { kind: 'presentation', extension };
    return { kind: 'archive', extension };
  }
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { kind: 'image', extension };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: 'image', extension };
  }
  if (head.length >= 6 && asciiStartsWith(head, 'GIF8')) return { kind: 'image', extension };
  if (isExecutableMagic(head)) return { kind: 'unsupported', extension };
  if (head.length >= 4 && asciiStartsWith(head, 'OLE2')) return { kind: 'unsupported', extension };
  if (looksBinary(fullBytes ?? head)) return { kind: 'unsupported', extension };
  return { kind: 'text', extension };
}

// Kinds whose extractor decodes the file bytes as text. Only these can be
// tricked by a binary renamed to a text-looking extension; container formats
// (pdf, docx/xlsx/pptx, images, archives) legitimately contain NUL bytes and
// are never run through the text/binary heuristic.
const TEXT_DECODED_KINDS: ReadonlySet<AttachmentKind> = new Set(['text', 'code', 'markdown', 'notebook']);

/**
 * One-shot detection used by the extractor registry / service. `fullBytes`
 * lets a text extension be validated against the whole (already size-capped)
 * file instead of just the 512-byte sniff window, so UTF-8/UTF-16 text is not
 * misread as binary when the sniff window cuts a code point in half.
 */
export function detectAttachmentKind(name: string, head: Uint8Array, fullBytes?: Uint8Array): AttachmentKindGuess {
  const byExtension = classifyByExtension(name);
  if (byExtension) {
    // Even a text-looking extension is checked for binary content so a renamed
    // executable is not silently decoded as UTF-8 (spec guardrail).
    if (
      TEXT_DECODED_KINDS.has(byExtension.kind)
      && (fullBytes ?? head).length > 0
      && looksBinary(fullBytes ?? head)
    ) {
      return { kind: 'unsupported', extension: byExtension.extension };
    }
    return byExtension;
  }
  return classifyContent(name, head, fullBytes);
}

/**
 * Encoding-aware binary test. Legal UTF-8 and UTF-16 Unicode text (Chinese,
 * Japanese, Korean, Emoji) must never be reported as binary. The decision is:
 * UTF-16 BOM -> text; strict UTF-8 decode -> text; otherwise consult NUL and
 * control-byte ratios. The old ASCII-percentage heuristic is gone because CJK
 * and Emoji are almost entirely bytes > 126 and were misclassified.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  return !isProbablyText(bytes);
}

function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  // UTF-16 text is full of NUL bytes; recognize the BOM before the NUL test.
  if (hasUtf16Bom(bytes)) return true;
  // Outside UTF-16, a NUL byte is a strong binary signal (executable headers,
  // compressed streams) even when the surrounding bytes happen to be valid
  // UTF-8 — e.g. an MZ header is technically valid UTF-8 but clearly binary.
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    // Not valid UTF-8: fall back to a control-byte ratio.
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) control += 1;
  }
  return sample.length < 16 || control / sample.length < 0.3;
}

function hasUtf16Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 2
    && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
}

/** MZ (PE/DOS), ELF and Mach-O headers -> executable payload, never text. */
function isExecutableMagic(head: Uint8Array): boolean {
  if (head.length < 2) return false;
  if (head[0] === 0x4d && head[1] === 0x5a) return true; // MZ
  if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true; // ELF
  if (head.length >= 4) {
    const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
    return magic === 0xfeedface || magic === 0xcefaedfe // Mach-O 32-bit
      || magic === 0xfeedfacf || magic === 0xcffaedfe // Mach-O 64-bit
      || magic === 0xcafebabe || magic === 0xbebafeca; // universal/fat
  }
  return false;
}

function extensionOf(name: string): string | undefined {
  const base = (name.split('/').pop() ?? name).trim().toLowerCase();
  const dotIndex = base.lastIndexOf('.');
  return dotIndex >= 0 && dotIndex < base.length - 1 ? base.slice(dotIndex + 1) : undefined;
}

function asciiStartsWith(bytes: Uint8Array, prefix: string): boolean {
  for (let index = 0; index < prefix.length; index += 1) {
    if (index >= bytes.length || bytes[index] !== prefix.charCodeAt(index)) return false;
  }
  return true;
}
