// Pure context-usage estimation for the webview ring (no vscode import).
//
// Token counts are approximated from character counts (a TS/JS/ML convention:
// ~4 chars per token). The active model's context window is the ceiling; when
// it is unknown the ring degrades to "—" (unsupported) rather than guessing.

export interface ContextUsageState {
  supported: boolean;
  percent: number;
  usedTokens: number;
  maxTokens?: number;
}

export const CHARS_PER_TOKEN = 4;

/** Estimate used tokens and the fraction of the model context window consumed. */
export function computeContextUsage(textLengthChars: number, maxTokens?: number): ContextUsageState {
  const usedTokens = Math.max(0, Math.ceil(textLengthChars / CHARS_PER_TOKEN));
  if (!maxTokens || maxTokens <= 0) {
    return { supported: false, percent: 0, usedTokens };
  }
  const percent = Math.max(0, Math.min(100, Math.round((usedTokens / maxTokens) * 100)));
  return { supported: true, percent, usedTokens, maxTokens };
}
