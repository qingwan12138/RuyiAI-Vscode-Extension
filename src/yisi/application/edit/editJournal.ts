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
