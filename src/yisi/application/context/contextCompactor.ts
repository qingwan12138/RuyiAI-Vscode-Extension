import { estimateTokens } from './contextUsage';

export interface CompactableMessage {
  role: string;
  text: string;
}

export interface CompactedHistory {
  /** The retained history (oldest-to-newest, current turn excluded). */
  messages: CompactableMessage[];
  /** Human note to prepend when history was dropped, else null. */
  note: string | null;
  droppedCount: number;
}

/**
 * Prevent "simple context overflow" crashes on long sessions (v0.7 DoD):
 * drop the oldest history turns that exceed a token budget, keeping the most
 * recent turns (and the caller keeps the live current turn verbatim). This is a
 * truncation-style compaction with an explicit note — LLM re-summarization is a
 * later enhancement. Never crashes on huge input; estimateTokens is bounded.
 */
export function compactHistory(messages: CompactableMessage[], historyBudgetTokens: number): CompactedHistory {
  if (messages.length === 0) return { messages: [], note: null, droppedCount: 0 };
  const budget = Math.max(0, Math.floor(historyBudgetTokens));
  // Keep a bounded suffix of the history; always keep at least the last message
  // so the model never loses the newest turns entirely.
  const lastIndex = messages.length - 1;
  let used = estimateTokens(messages[lastIndex].text);
  let keepFrom = lastIndex;
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const next = used + estimateTokens(messages[index].text);
    if (next > budget) break;
    used = next;
    keepFrom = index;
  }
  const retained = messages.slice(keepFrom);
  const note = keepFrom > 0
    ? `[Earlier conversation omitted: ${keepFrom} older message(s) to fit the context window. ` +
      'Retaining the most recent turns; the newer instructions are authoritative.]'
    : null;
  return { messages: retained, note, droppedCount: keepFrom };
}
