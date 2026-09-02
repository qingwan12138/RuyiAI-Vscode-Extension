// DOCX extractor. Uses mammoth (BSD-2-Clause, pure JS) with an injectable
// module so tests can provide a fake. Mammoth walks the document in order, so
// headings, paragraphs, list items and tables all surface as plain text.

import { randomUUID } from 'node:crypto';
import { AttachmentExtractionResult, AttachmentExtractOptions, AttachmentFileInput } from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';
import { truncateToChars } from './attachmentText';
import { ZipLoader, assertZipBytesSafe } from './zipSafety';

export interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}

export class DocxExtractor implements AttachmentExtractor {
  readonly id = 'docx';

  constructor(
    private readonly mammoth: MammothModule,
    private readonly zip: ZipLoader
  ) {}

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'document' && input.extension === 'docx';
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    // A .docx is a ZIP container: reject decompression bombs before mammoth
    // inflates document.xml.
    await assertZipBytesSafe(this.zip, input.bytes);

    let value: string;
    try {
      const result = await this.mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
      value = result.value;
    } catch (error) {
      throw new AttachmentExtractionError('This .docx document could not be read.', { cause: error });
    }

    const warnings: string[] = [];
    const cut = truncateToChars(value.replace(/\r\n/g, '\n').trim(), options.maxChars);
    if (cut.truncated) {
      warnings.push('Large document attached. Only the first portion is included in v0.1.');
    }
    return {
      kind: input.kind,
      text: cut.text,
      chunks: [{
        id: randomUUID(),
        text: cut.text,
        startLine: 1,
        endLine: lineCountOf(cut.text)
      }],
      truncated: cut.truncated,
      warnings
    };
  }
}

function lineCountOf(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}
