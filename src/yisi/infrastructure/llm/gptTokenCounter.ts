// OpenAI-compatible token counting via gpt-tokenizer (MIT, pure JS).
//
// Accurate for OpenAI model families (model-aware encoding); for other models
// (DeepSeek/Qwen/Llama/Claude) it still returns a reasonable proxy token count,
// and a failure falls back to the bilingual heuristic (contextUsage.estimateTokens).

import { encode } from 'gpt-tokenizer';
import { estimateTokens } from '../../application/context/contextUsage';

/** Choose the gpt-tokenizer model (encodings differ per family). */
export function modelEncodingForTokenCount(modelId?: string): string | undefined {
  const id = (modelId ?? '').trim().toLowerCase();
  if (!id) return undefined;
  if (/gpt-4o|gpt-4\.1|gpt-5|(^|-)o[1345](-|$)|o200k/.test(id)) return 'gpt-4o';
  if (/gpt-3\.5|gpt-4(?!\.1)|gpt-oss|gpt-2|gpt-3/.test(id)) return 'gpt-3.5-turbo';
  return undefined;
}

/** Count tokens for one text block; falls back to the bilingual estimate. */
export function countTokens(text: string, modelId?: string): number {
  if (!text) return 0;
  const model = modelEncodingForTokenCount(modelId);
  try {
    const tokens = encode(text, model ? { model } : undefined);
    return Array.isArray(tokens) ? tokens.length : estimateTokens(text);
  } catch {
    return estimateTokens(text);
  }
}
