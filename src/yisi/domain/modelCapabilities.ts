import { ProviderKind } from './providerConfiguration';

/**
 * Central model-capability refinement. Provider transports are intentionally
 * model-agnostic; this registry is the one place where Yisi recognizes known
 * model families. Unknown compatible/local models stay conservative unless an
 * explicit provider capability override is configured.
 */
export function modelSupportsVision(
  kind: ProviderKind,
  modelId: string,
  configured?: boolean
): boolean {
  if (configured !== undefined) return configured;
  const id = modelId.trim().toLowerCase();
  if (!id) return false;

  switch (kind) {
    case 'deepseek':
      // Keep the heuristic narrow and centralized. This covers provider model
      // ids such as deepseek-v4-flash-vision-exp without teaching the Webview
      // about model naming conventions.
      return hasVisionMarker(id) || /^janus(?:[-_.]|$)/.test(id);
    case 'openai':
      return /^gpt-4o(?:[-_.]|$)/.test(id)
        || /^gpt-4\.1(?:[-_.]|$)/.test(id)
        || /^gpt-4-turbo(?:[-_.]|$)/.test(id)
        || /^o[134](?:[-_.]|$)/.test(id)
        || hasVisionMarker(id);
    case 'anthropic':
      // Modern Claude 3+ families accept image blocks. Unknown/non-Claude
      // Anthropic-compatible ids remain conservative.
      return /^claude-(?:3(?:[-_.]|$)|3\.|sonnet|opus|haiku)/.test(id);
    case 'openaiCompatible':
    case 'llamaCpp':
      return hasVisionMarker(id)
        || /(?:^|[-_.])llava(?:[-_.]|$)/.test(id)
        || /qwen[^/]*[-_.]?vl(?:[-_.]|$)/.test(id)
        || /^janus(?:[-_.]|$)/.test(id);
  }
}

function hasVisionMarker(id: string): boolean {
  return /(?:^|[-_.])(vision|multimodal)(?:[-_.]|$)/.test(id)
    || /(?:^|[-_.])vl(?:[-_.]|$)/.test(id);
}
