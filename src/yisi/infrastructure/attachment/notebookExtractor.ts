// Jupyter Notebook (.ipynb) extractor — pure JSON parsing, no dependencies.
// Keeps markdown/code cells and text/error outputs; base64 image outputs are
// never injected into text context.

import { randomUUID } from 'node:crypto';
import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput
} from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';
import { truncateToChars } from './attachmentText';

export class NotebookExtractor implements AttachmentExtractor {
  readonly id = 'notebook';

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'notebook';
  }

  async extract(input: AttachmentFileInput, options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    const cells = parseNotebookCells(input.bytes);
    const maxCells = 300; // bounded working set; final text is still char-capped
    const included = cells.slice(0, maxCells);
    const parts: string[] = [];
    let markdown = 0;
    let code = 0;

    included.forEach((cell, index) => {
      if (cell.type === 'markdown') {
        markdown += 1;
        const text = joinSource(cell.source);
        parts.push(`Markdown cell ${index + 1}:\n${text}`);
      } else if (cell.type === 'code') {
        code += 1;
        parts.push(`Code cell ${index + 1}:\n\`\`\`\n${joinSource(cell.source)}\n\`\`\``);
        const output = formatOutputs(cell.outputs);
        if (output) parts.push(output);
      } else {
        parts.push(`Cell ${index + 1} (${cell.type}):\n${joinSource(cell.source)}`);
      }
    });

    const joined = parts.join('\n\n');
    const cut = truncateToChars(joined, options.maxChars);
    const warnings: string[] = [];
    if (cells.length > maxCells) {
      warnings.push(`Notebook truncated to the first ${maxCells} cells.`);
    }
    if (cut.truncated) {
      warnings.push('Notebook is large. Only the first portion is included in v0.1.');
    }

    return {
      kind: input.kind,
      text: cut.text,
      chunks: [{
        id: randomUUID(),
        text: cut.text,
        startLine: 1,
        endLine: undefined
      }],
      truncated: cut.truncated || cells.length > maxCells,
      warnings,
      metadata: { notebooks: { markdown, code } }
    };
  }
}

interface NotebookCell {
  type: string;
  source: unknown;
  outputs?: unknown[];
}

function parseNotebookCells(bytes: Uint8Array): NotebookCell[] {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new AttachmentExtractionError('This .ipynb file is not valid notebook JSON.', { cause: error });
  }
  if (!isRecord(document) || !Array.isArray(document.cells)) {
    throw new AttachmentExtractionError('This notebook has no cell list.');
  }
  const cells: NotebookCell[] = [];
  for (const cell of document.cells) {
    if (!isRecord(cell) || typeof cell.cell_type !== 'string') continue;
    cells.push({ type: cell.cell_type, source: cell.source, outputs: Array.isArray(cell.outputs) ? cell.outputs : undefined });
  }
  return cells;
}

function joinSource(source: unknown): string {
  if (typeof source === 'string') return source;
  if (Array.isArray(source)) return source.filter(item => typeof item === 'string').join('');
  return '';
}

function formatOutputs(outputs: unknown[] | undefined): string {
  if (!outputs || outputs.length === 0) return '';
  const lines: string[] = [];
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    if (output.output_type === 'stream') {
      lines.push(joinSource(output.text).replace(/\n+$/, ''));
    } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
      const text = extractTextFromData(output.data);
      if (text) lines.push(text.replace(/\n+$/, ''));
    } else if (output.output_type === 'error') {
      const name = typeof output.ename === 'string' ? output.ename : 'Error';
      const value = typeof output.evalue === 'string' ? output.evalue : '';
      lines.push(`Error: ${name}: ${value}`);
    }
  }
  if (lines.length === 0) return '';
  return `Output:\n${lines.join('\n')}`;
}

function extractTextFromData(data: unknown): string {
  if (!isRecord(data)) return '';
  for (const key of ['text/plain', 'text/html', 'text/markdown']) {
    if (typeof data[key] === 'string') return data[key];
    if (Array.isArray(data[key])) {
      const joined = data[key].filter(item => typeof item === 'string').join('');
      if (joined) return joined;
    }
  }
  // Base64 image outputs are intentionally NOT included in text context.
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
