// Text/code/markdown extractor. Kept dependency free: UTF-8/UTF-16 decode plus
// a hard character cap with line metadata.

import { randomUUID } from 'node:crypto';
import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput,
  AttachmentKind
} from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { chunkByLines, decodeAttachmentText, truncateToChars } from './attachmentText';

const TEXT_KINDS: ReadonlySet<AttachmentKind> = new Set(['text', 'code', 'markdown']);

export class TextExtractor implements AttachmentExtractor {
  readonly id = 'text';

  canHandle(input: AttachmentFileInput): boolean {
    return TEXT_KINDS.has(input.kind);
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    const { text, encoding } = decodeAttachmentText(input.bytes);
    const cut = truncateToChars(text, options.maxChars);
    const warnings: string[] = [];
    if (encoding !== 'utf-8') warnings.push(`Decoded as ${encoding}.`);
    if (cut.truncated) {
      warnings.push('Large file attached. Only the first portion is included in v0.1.');
    }
    return {
      kind: input.kind,
      text: cut.text,
      chunks: chunkByLines(cut.text).map(chunk => ({ id: randomUUID(), ...chunk })),
      truncated: cut.truncated,
      warnings
    };
  }
}
