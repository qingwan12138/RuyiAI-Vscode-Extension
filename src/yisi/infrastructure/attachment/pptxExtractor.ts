// PPTX extractor. A .pptx is a zip of DrawingML XML; this extractor reads the
// slide parts (ppt/slides/slideN.xml) with jszip (MIT, pure JS) and pulls the
// text runs (<a:t>) out in slide order. Tables store their text in the same
// run elements, so table cells are included. Slide notes are skipped in v0.1.

import { randomUUID } from 'node:crypto';
import { AttachmentExtractionResult, AttachmentExtractOptions, AttachmentFileInput } from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';
import { ZipArchiveLike, ZipLoader, assertZipSafe } from './zipSafety';

const SLIDE_PATTERN = /^ppt\/slides\/slide(\d+)\.xml$/;

export class PptxExtractor implements AttachmentExtractor {
  readonly id = 'pptx';

  constructor(private readonly zip: ZipLoader) {}

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'presentation' && input.extension === 'pptx';
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    let archive: ZipArchiveLike;
    try {
      archive = await this.zip.loadAsync(input.bytes);
    } catch (error) {
      throw new AttachmentExtractionError('This .pptx file could not be opened as a package.', { cause: error });
    }
    assertZipSafe(archive);

    const slideNumbers = Object.keys(archive.files)
      .map(path => {
        const match = SLIDE_PATTERN.exec(path);
        return match ? Number(match[1]) : undefined;
      })
      .filter((number): number is number => number !== undefined)
      .sort((a, b) => a - b);

    if (slideNumbers.length === 0) {
      throw new AttachmentExtractionError('This .pptx file contains no slides.');
    }

    const parts: string[] = [];
    const chunks = [];
    const warnings: string[] = [];
    let chars = 0;
    let truncated = false;

    for (const slideNumber of slideNumbers) {
      options.signal?.throwIfAborted();
      let xml: string;
      try {
        xml = await archive.files[`ppt/slides/slide${slideNumber}.xml`].async('string');
      } catch (error) {
        warnings.push(`Slide ${slideNumber} could not be read and was skipped.`);
        continue;
      }
      const slideText = extractRunText(xml);
      if (!slideText) continue; // empty/deleted slide placeholder
      const block = `Slide ${slideNumber}:\n${slideText}`;
      if (chars + block.length + 1 > options.maxChars) {
        truncated = true;
        break;
      }
      parts.push(block);
      chunks.push({ id: randomUUID(), text: block, slide: slideNumber });
      chars += block.length + 1;
    }

    if (truncated) {
      warnings.push('Large presentation attached. Only the first slides are included in v0.1.');
    }
    if (parts.length === 0) {
      throw new AttachmentExtractionError('This presentation contains no extractable slide text.');
    }

    return {
      kind: input.kind,
      text: parts.join('\n\n'),
      chunks,
      metadata: { slides: slideNumbers.length },
      truncated,
      warnings
    };
  }
}

/** Text of every <a:t> run, joined with line breaks between paragraphs. */
function extractRunText(xml: string): string {
  const lines: string[] = [];
  const runRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;

  let paraStart = xml.indexOf('<a:p');
  while (paraStart !== -1) {
    const openEnd = xml.indexOf('>', paraStart);
    if (openEnd === -1) break;
    const close = xml.indexOf('</a:p>', openEnd);
    if (close === -1) break;
    const region = xml.slice(openEnd + 1, close);

    const runs: string[] = [];
    let run: RegExpExecArray | null;
    while ((run = runRe.exec(region)) !== null) {
      const text = decodeXmlEntities(run[1]).trim();
      if (text) runs.push(text);
    }
    if (runs.length > 0) lines.push(runs.join(' '));

    paraStart = xml.indexOf('<a:p', close + 6);
  }
  return lines.join('\n');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => safeChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}
