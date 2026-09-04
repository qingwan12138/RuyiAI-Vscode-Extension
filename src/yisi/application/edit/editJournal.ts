// Pure change summary + journaling types for agent workspace edits (A2).
// The journal is bounded, memory-light, and records enough structured
// information (before/after hashes, change summary, reverse plan) for the
// undo tool to revert the most recent workspace mutation safely.

export type JournalMutationKind =
  | 'replace_text'
  | 'create_text_file'
  | 'rewrite_text_file'
  | 'delete_file'
  | 'rename_file'
  | 'create_directory';

export interface TextChangeSummary {
  addedLines: number;
  removedLines: number;
  /** Up to 6 sample lines of what appeared / disappeared (multiset-aware). */
  addedPreview: string[];
  removedPreview: string[];
}

/**
 * Compact multiset line comparison. Only lines whose occurrence count actually
 * changed are counted as added/removed, so duplicating an existing line counts
 * as one addition instead of a full-file "diff" noise.
 */
export function summarizeTextChange(beforeText: string, afterText: string): TextChangeSummary {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const beforeCounts = countLines(beforeLines);
  const afterCounts = countLines(afterLines);

  let addedLines = 0;
  let removedLines = 0;
  const lineNames = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
  for (const line of lineNames) {
    const beforeCount = beforeCounts.get(line) ?? 0;
    const afterCount = afterCounts.get(line) ?? 0;
    if (afterCount > beforeCount) addedLines += afterCount - beforeCount;
    if (beforeCount > afterCount) removedLines += beforeCount - afterCount;
  }

  return {
    addedLines,
    removedLines,
    addedPreview: sampleAdded(beforeCounts, afterLines),
    removedPreview: sampleRemoved(afterCounts, beforeLines)
  };
}

/** Whether an edit outcome can be reverted given the captured information. */
export type Reversibility = 'reversible' | 'non-reversible';

export interface EditJournalEntry {
  id: string;
  kind: JournalMutationKind;
  path: string;
  beforeSha256?: string;
  afterSha256?: string;
  /** Present when before/after text was captured under the size budget. */
  summary?: TextChangeSummary;
  reversibility: Reversibility;
  /** Human reason when the entry cannot be reverted. */
  reason?: string;
  /** Full previous content, present only when small enough to retain. */
  capturedBeforeText?: string;
  capturedAfterText?: string;
  capturedToPath?: string;
}

export const MAX_JOURNAL_ENTRIES = 6;

/** Cap for text retained in the journal; bigger edits may still be reversible
 *  through create/delete without retaining content, otherwise non-reversible. */
export const MAX_JOURNAL_TEXT_BYTES = 64 * 1024;

export function countBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

const MAX_DIFF_LINES_PER_SIDE = 1_200;

/**
 * Render a plain-text, unified-ish diff for the journal viewer. Line-based LCS
 * alignment with `-`/`+`/` ` prefixes and a small header; files too large for
 * the bounded LCS fall back to an honest note instead of a noisy dump.
 */
export function renderTextDiff(beforeText: string, afterText: string, label: string): string {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  if (beforeLines.length > MAX_DIFF_LINES_PER_SIDE || afterLines.length > MAX_DIFF_LINES_PER_SIDE) {
    return `${label}: file too large for an inline diff (${beforeLines.length} → ${afterLines.length} lines).`
      + `\nRemoved lines: ${countChanged(beforeLines, afterLines).removed}, added lines: ${countChanged(beforeLines, afterLines).added}`;
  }
  const edit = align(beforeLines, afterLines);
  if (edit.every(line => line.startsWith(' '))) {
    return `${label}: no line-level changes detected.`;
  }
  const header = [
    `--- ${label} (before)`,
    `+++ ${label} (after)`,
    `@@ -${beforeLines.length} +${afterLines.length} @@`
  ];
  return [...header, ...edit].join('\n');
}

function align(beforeLines: string[], afterLines: string[]): string[] {
  const beforeCount = beforeLines.length;
  const afterCount = afterLines.length;
  const dp = Array.from({ length: beforeCount + 1 }, () => new Uint32Array(afterCount + 1));
  for (let i = beforeCount - 1; i >= 0; i -= 1) {
    for (let j = afterCount - 1; j >= 0; j -= 1) {
      dp[i][j] = beforeLines[i] === afterLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const output: string[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeCount && j < afterCount) {
    if (beforeLines[i] === afterLines[j]) {
      output.push(` ${beforeLines[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      output.push(`-${beforeLines[i]}`);
      i += 1;
    } else {
      output.push(`+${afterLines[j]}`);
      j += 1;
    }
  }
  while (i < beforeCount) {
    output.push(`-${beforeLines[i]}`);
    i += 1;
  }
  while (j < afterCount) {
    output.push(`+${afterLines[j]}`);
    j += 1;
  }
  return output;
}

interface LineCounts {
  added: number;
  removed: number;
}

function countChanged(beforeLines: string[], afterLines: string[]): LineCounts {
  const summary = summarizeTextChange(beforeLines.join('\n'), afterLines.join('\n'));
  return { added: summary.addedLines, removed: summary.removedLines };
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/);
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function sampleAdded(beforeCounts: Map<string, number>, afterLines: string[]): string[] {
  const remaining = new Map(beforeCounts);
  const preview: string[] = [];
  for (const line of afterLines) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else if (preview.length < 6) {
      preview.push(line);
    }
  }
  return preview;
}

function sampleRemoved(afterCounts: Map<string, number>, beforeLines: string[]): string[] {
  const remaining = new Map(afterCounts);
  const preview: string[] = [];
  for (const line of beforeLines) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else if (preview.length < 6) {
      preview.push(line);
    }
  }
  return preview;
}
