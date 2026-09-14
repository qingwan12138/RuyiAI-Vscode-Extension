import { ProviderKind } from './providerConfiguration';

/**
 * Central model-capability refinement. Provider transports are intentionally
 * model-agnostic; this registry is the one place where Yisi recognizes known
 * model families. Unknown compatible/local models stay conservative unless an
 * explicit provider capability override is configured.
 */
/**
 * Vision capability of the known DeepSeek lineup (official Models & Pricing
 * table, 2026-09). The current ids carry no hint in their name: the vision
 * model is plain `deepseek-flash` (DeepSeek-V4.1-Flash), so the generic
 * `vision`-marker heuristic below would judge it blind. `deepseek-v4-flash` and
 * `deepseek-v4-flash-vision-exp` were retired but are still accepted by the API
 * and are served by the V4.1-Flash model, so they keep vision too.
 */
const DEEPSEEK_VISION: Readonly<Record<string, boolean>> = {
  'deepseek-flash': true,
  'deepseek-v4-flash': true,
  'deepseek-v4-flash-vision-exp': true,
  'deepseek-v4-pro': false,
  'deepseek-chat': false,
  'deepseek-reasoner': false
};

export function modelSupportsVision(
  kind: ProviderKind,
  modelId: string,
  configured?: boolean
): boolean {
  if (configured !== undefined) return configured;
  const id = modelId.trim().toLowerCase();
  if (!id) return false;

  switch (kind) {
    case 'deepseek': {
      const known = DEEPSEEK_VISION[id];
      if (known !== undefined) return known;
      // An explicit marker always wins, so a future vision variant of a
      // non-vision family (e.g. `deepseek-v4-pro-vision`) is recognized.
      if (hasVisionMarker(id) || /^janus(?:[-_.]|$)/.test(id)) return true;
      // Otherwise inherit from the known family this id extends, which covers
      // dated variants such as `deepseek-flash-0813`.
      return knownFamilyVision(DEEPSEEK_VISION, id);
    }
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

/** Capability of the longest known family an id extends, else false. */
function knownFamilyVision(table: Readonly<Record<string, boolean>>, id: string): boolean {
  const families = Object.keys(table).sort((left, right) => right.length - left.length);
  for (const family of families) {
    if (id.startsWith(`${family}-`) || id.startsWith(`${family}_`) || id.startsWith(`${family}.`)) {
      return table[family];
    }
  }
  return false;
}

function hasVisionMarker(id: string): boolean {
  return /(?:^|[-_.])(vision|multimodal)(?:[-_.]|$)/.test(id)
    || /(?:^|[-_.])vl(?:[-_.]|$)/.test(id);
}
