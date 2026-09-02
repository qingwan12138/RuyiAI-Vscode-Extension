// CSV / TSV extractor — dependency-free, quote-aware row parsing. Large CSV/TSV
// files are row- and char-capped so they never flood the model context. Real
// workbooks (*.xlsx/*.xls) use the spreadsheet extractor instead.

import { randomUUID } from 'node:crypto';
import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput
} from '../../context/attachment/attachmentTypes';
import { ATTACHMENT_LIMITS } from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { decodeAttachmentText, truncateToChars } from './attachmentText';

export class DelimitedSpreadsheetExtractor implements AttachmentExtractor {
  readonly id = 'delimited';

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'spreadsheet'
      && (input.extension === 'csv' || input.extension === 'tsv');
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    const delimiter = input.extension === 'tsv' ? '\t' : ',';
    const { text } = decodeAttachmentText(input.bytes);
    const { rows, totalRows, truncated: rowsTruncated } = parseRows(text, delimiter, ATTACHMENT_LIMITS.maxSheetRows);
    const maxChars = options.maxChars;
    const warnings: string[] = [];

    const lines: string[] = [];
    let includedChars = 0;
    let charsTruncated = false;
    for (let index = 0; index < rows.length; index += 1) {
      const cells = rows[index].map(cell => collapse(cell));
      const line = `${index + 1} | ${cells.join(' | ')}`;
      if (includedChars + line.length + 1 > maxChars) {
        charsTruncated = true;
        break;
      }
      lines.push(line);
      includedChars += line.length + 1;
    }

    const processedRows = lines.length;
    const body = lines.join('\n');
    // The header reports the true total row count so the model never believes a
    // truncated CSV is complete. totalRows is the real count even when rows are
    // capped to ATTACHMENT_LIMITS.maxSheetRows.
    const head = totalRows > 0 && processedRows > 0 ? `Rows ${1}-${processedRows} of ${totalRows}:\n` : '';
    const full = head + body;
    const cut = truncateToChars(full, maxChars);

    if (rowsTruncated) {
      warnings.push(`This spreadsheet has ${totalRows} rows; only the first ${ATTACHMENT_LIMITS.maxSheetRows} were read.`);
    }
    if (charsTruncated || cut.truncated) {
      warnings.push('Large spreadsheet attached. Only the first rows are included in v0.1.');
    }
    return {
      kind: input.kind,
      text: cut.text,
      chunks: [{
        id: randomUUID(),
        text: cut.text,
        sheet: input.name,
        cellRange: `A1:${columnName(rows[0]?.length ?? 1)}${processedRows}`,
        startLine: 1,
        endLine: processedRows
      }],
      truncated: rowsTruncated || charsTruncated || cut.truncated,
      warnings,
      metadata: { cells: totalRows }
    };
  }
}

/**
 * Quote-aware CSV/TSV row splitter. Keeps at most `maxRows` rows for rendering
 * but still counts every physical row so the caller can report the real total
 * and mark the result truncated instead of pretending the file was complete.
 */
function parseRows(text: string, delimiter: string, maxRows: number): { rows: string[][]; totalRows: number; truncated: boolean } {
  if (text.length === 0) return { rows: [], totalRows: 0, truncated: false };
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let totalRows = 0;
  const endRow = () => {
    row.push(cell);
    totalRows += 1;
    if (rows.length < maxRows) rows.push(row);
    row = [];
    cell = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(cell); cell = ''; continue; }
    if (char === '\n') { endRow(); continue; }
    if (char === '\r') continue;
    cell += char;
  }
  // A trailing delimiter-less final line.
  if (cell !== '' || row.length > 0) endRow();
  return { rows, totalRows, truncated: totalRows > maxRows };
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
