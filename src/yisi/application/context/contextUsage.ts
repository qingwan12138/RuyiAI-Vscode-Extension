// Pure context-usage estimation for the webview ring (no vscode import).
//
// Token counts are estimated from character content with a bilingual heuristic:
//   * CJK characters are ~1 token each (the naive chars/4 rule undercounts them
//     ~4x, which made Chinese sessions look far too small);
//   * non-CJK text is ~4 chars/token.
// The active model's context window is the ceiling; when it is unknown the ring
// degrades to "—" (unsupported) rather than guessing.

export interface ContextUsageState {
  supported: boolean;
  percent: number;
  usedTokens: number;
  maxTokens?: number;
}

export const CHARS_PER_TOKEN = 4;

/** Rough token estimate that treats CJK chars as ~1 token each. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const codePoint of text) {
    if (isCjk(codePoint)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * 1.0 + other / CHARS_PER_TOKEN);
}

/** Estimate used tokens and the fraction of the model context window consumed. */
export function computeContextUsage(tokenCount: number, maxTokens?: number): ContextUsageState {
  const usedTokens = Math.max(0, tokenCount);
  if (!maxTokens || maxTokens <= 0) {
    return { supported: false, percent: 0, usedTokens };
  }
  const percent = Math.max(0, Math.min(100, Math.round((usedTokens / maxTokens) * 100)));
  return { supported: true, percent, usedTokens, maxTokens };
}

/** Rough overhead for system prompt + tool definitions shared by every turn. */
export const CONTEXT_OVERHEAD_TOKENS = 2_000;

function isCjk(codePoint: string): boolean {
  const code = codePoint.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) // CJK Unified Ideographs
    || (code >= 0x3400 && code <= 0x4dbf) // Extension A
    || (code >= 0x3000 && code <= 0x303f) // CJK punctuation
    || (code >= 0xff00 && code <= 0xffef) // Fullwidth forms
    || (code >= 0x3040 && code <= 0x30ff) // Hiragana / Katakana
    || (code >= 0xac00 && code <= 0xd7af) // Hangul
  );
}
