// Spreadsheet extractor for real workbooks (*.xlsx). Uses `read-excel-file`
// (MIT, pure JS, read-only) with an injectable module so tests can provide a
// fake. CSV/TSV go through DelimitedSpreadsheetExtractor; legacy .xls/.ods have
// no maintained, pure-JS, safe reader in v0.1 and are rejected upstream.
// Worksheets and rows are bounded (maxSheets/maxSheetRows) and the rendered
// text is still char-capped so a huge sheet never floods context. Rendering
// keeps cell positions as `row | c1 | c2 …` so column alignment survives the
// text model. The container is ZIP-guarded before parsing to stop bombs.

import { randomUUID } from 'node:crypto';
import {
  AttachmentChunk,
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput
} from '../../context/attachment/attachmentTypes';
import { ATTACHMENT_LIMITS } from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';
import { truncateToChars } from './attachmentText';
import { ZipLoader, assertZipBytesSafe } from './zipSafety';

/** One worksheet as returned by read-excel-file: `sheet` is the name, `data` is rows. */
export interface XlsxSheetLike {
  sheet: string;
  data: unknown[][];
}

export interface ReadXlsxFile {
  (data: Uint8Array | ArrayBuffer): Promise<XlsxSheetLike[]>;
}

export class SpreadsheetExtractor implements AttachmentExtractor {
  readonly id = 'spreadsheet';

  constructor(
    private readonly readXlsxFile: ReadXlsxFile,
    private readonly zip: ZipLoader
  ) {}

  canHandle(input: AttachmentFileInput): boolean {
    // Only .xlsx in v0.1: .csv/.tsv go through DelimitedSpreadsheetExtractor and
    // legacy .xls/.ods have no maintained, pure-JS, safe reader here.
    return input.kind === 'spreadsheet' && input.extension === 'xlsx';
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    await assertZipBytesSafe(this.zip, input.bytes);

    let sheets: XlsxSheetLike[];
    try {
      sheets = await this.readXlsxFile(new Uint8Array(input.bytes));
    } catch (error) {
      throw new AttachmentExtractionError('This spreadsheet file could not be parsed.', { cause: error });
    }
    if (!sheets || sheets.length === 0) {
      throw new AttachmentExtractionError('This spreadsheet file contains no worksheets.');
    }

    const includedSheets = sheets.slice(0, ATTACHMENT_LIMITS.maxSheets);
    const warnings: string[] = [];
    const parts: string[] = [];
    const chunks: AttachmentChunk[] = [];
    const sheetNames: string[] = [];
    let usedChars = 0;
    let truncated = false;

    for (const sheet of includedSheets) {
      options.signal?.throwIfAborted();
      const rows = sheet.data ?? [];
      const limitedRows = rows.slice(0, ATTACHMENT_LIMITS.maxSheetRows);
      const header = rows.length > 0
        ? `[Sheet: ${sheet.sheet}] Rows 1-${limitedRows.length} of ${rows.length}:\n`
        : `[Sheet: ${sheet.sheet}] (empty)\n`;
      const lines: string[] = [];
      for (let index = 0; index < limitedRows.length; index += 1) {
        const cells = limitedRows[index].map(cell => cellToText(cell).replace(/\s+/g, ' ').trim());
        lines.push(`${index + 1} | ${cells.join(' | ')}`);
      }
      let block = header + lines.join('\n');
      if (block.trim().length === 0) block = header;

      const remaining = options.maxChars - usedChars;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const cellRange = rangeOf(limitedRows);
      if (block.length > remaining) {
        const cut = truncateToChars(block, remaining);
        parts.push(cut.text);
        chunks.push({ id: randomUUID(), text: cut.text, sheet: sheet.sheet, cellRange });
        usedChars += cut.text.length;
        truncated = true;
        break;
      }
      parts.push(block);
      chunks.push({ id: randomUUID(), text: block, sheet: sheet.sheet, cellRange });
      usedChars += block.length;
      sheetNames.push(sheet.sheet);
    }

    if (sheets.length > includedSheets.length) truncated = true;
    if (truncated) {
      warnings.push('Large spreadsheet attached. Only the first worksheets / rows are included in v0.1.');
    }

    return {
      kind: input.kind,
      text: parts.join('\n\n'),
      chunks,
      truncated,
      warnings,
      metadata: { sheets: sheetNames }
    };
  }
}

function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell);
}

/** A1-style range covering the bounded rows actually rendered. */
function rangeOf(rows: unknown[][]): string {
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return `A1:${columnName(maxColumns)}${rows.length}`;
}

function columnName(index: number): string {
  let value = Math.max(1, index);
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
