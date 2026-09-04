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
  // OpenAI: gpt-4o era 128k, reasoning (o1/o3) 200k, 4.1 1M reserved below.
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 1_000_000,
  'o1': 200_000,
  'o3': 200_000,
  // Anthropic Claude 3+ default 200k.
  'claude-3': 200_000,
  'claude-3.5': 200_000,
  'claude-3.7': 200_000,
  'claude-sonnet': 200_000,
  'claude-opus': 200_000,
  'claude-haiku': 200_000,
  // DeepSeek chat/reasoner 64k; newer variants assumed 128k.
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'deepseek-v4': 128_000,
  'deepseek-r1': 64_000,
  // Qwen (local / compatible) families.
  'qwen2.5': 128_000,
  'qwen3': 128_000
};

/** Resolve a context-window estimate, or undefined when unknown. */
export function modelContextWindow(
  kind: ProviderKind,
  modelId: string,
  configured?: number
): number | undefined {
  if (configured !== undefined && configured > 0) return configured;
  const id = modelId.trim().toLowerCase();
  if (!id) return undefined;
  // Match against known prefixes/keys in priority order.
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
      return 64_000;
    case 'openaiCompatible':
    case 'llamaCpp':
      return undefined;
    default:
      return undefined;
  }
}
