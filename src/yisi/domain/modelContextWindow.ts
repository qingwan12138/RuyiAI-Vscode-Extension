// Built-in context-window sizes by model family (pure, testable).
//
// Many providers do not report a context window, so the UI ring needs a
// conservative default per known family. An explicit provider-configured
// `contextLength` always wins over this heuristic.

import { ProviderKind } from './providerConfiguration';

export type ModelContextWindowResolver = (
  kind: ProviderKind,
  modelId: string,
  configured?: number
) => number | undefined;

/** Known families -> approximate context window in tokens. */
const KNOWN_WINDOWS: Readonly<Record<string, number>> = {
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 1_000_000,
  'o1': 200_000,
  'o3': 200_000,
  'gpt-5': 400_000,
  // Anthropic Claude 3+ default 200k (some variants 1M).
  'claude-3': 200_000,
  'claude-3.5': 200_000,
  'claude-3.7': 200_000,
  'claude-sonnet': 200_000,
  'claude-opus': 200_000,
  'claude-haiku': 200_000,
  'claude-4': 200_000,
  // DeepSeek chat/reasoner 64k; V4 family is million-token context per public
  // releases ("Million-Token Context"), so V4-prefixed ids get 1M.
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'deepseek-v4': 1_000_000,
  'deepseek-r1': 64_000,
  // Qwen
  'qwen2.5': 128_000,
  'qwen3': 128_000,
  'qwen1.5': 32_000,
  // Llama
  'llama-3': 128_000,
  'llama-4': 1_000_000,
  // Other open models
  'mistral-large': 128_000,
  'mistral-small': 32_000,
  'glm-4': 128_000,
  'glm-4.5': 128_000,
  'kimi': 128_000,
  'moonshot': 128_000,
  'yi-': 32_000,
  'internlm': 32_000,
  'minimax': 128_000,
  'command-r': 128_000
};

export interface ModelWindowOverride {
  /** Substring matched (case-insensitive) against the model id. */
  model: string;
  windowTokens: number;
}

/** Resolve a context-window estimate, or undefined when unknown. */
export function modelContextWindow(
  kind: ProviderKind,
  modelId: string,
  configured?: number,
  overrides: readonly ModelWindowOverride[] = []
): number | undefined {
  if (configured !== undefined && configured > 0) return configured;
  const id = modelId.trim().toLowerCase();
  if (!id) return undefined;
  // 1) user-configured overrides (any model, substring match).
  for (const override of overrides) {
    if (!override || typeof override.model !== 'string' || !override.model.trim()) continue;
    if (id.includes(override.model.trim().toLowerCase()) && override.windowTokens > 0) {
      return override.windowTokens;
    }
  }
  // 2) known prefix table.
  const exact = KNOWN_WINDOWS[id];
  if (exact) return exact;
  for (const [key, windowSize] of Object.entries(KNOWN_WINDOWS)) {
    if (id.startsWith(key)) return windowSize;
  }
  switch (kind) {
    case 'openai':
      return /^gpt-4o|^gpt-4\.1|^o[134]/.test(id) ? 128_000 : undefined;
    case 'anthropic':
      return /^claude-(3|sonnet|opus|haiku)/.test(id) ? 200_000 : undefined;
    case 'deepseek':
      return /^deepseek-v4/.test(id) ? 1_000_000 : 64_000;
    case 'openaiCompatible':
    case 'llamaCpp':
      return undefined;
    default:
      return undefined;
  }
}
