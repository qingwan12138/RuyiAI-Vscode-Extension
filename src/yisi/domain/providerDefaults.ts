import { ProviderKind } from './providerConfiguration';

/**
 * Suggested model ids per provider kind, used as the initial model list before
 * (and as a fallback when) remote discovery runs. Kept in the domain so the
 * naming stays centralized and unit-testable instead of being hard-coded in the
 * vscode wizard or the Webview.
 *
 * DeepSeek: the V4 family is the current lineup (deepseek-v4-pro /
 * deepseek-v4-flash, plus the experimental deepseek-v4-flash-vision-exp which is
 * the only id that accepts image input). deepseek-chat / deepseek-reasoner are
 * kept as the previous-generation fallbacks.
 */
export const DEFAULT_MODELS_BY_KIND: Readonly<Partial<Record<ProviderKind, readonly string[]>>> = {
  deepseek: [
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
    'deepseek-chat',
    'deepseek-reasoner'
  ],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5']
};

/** Default model ids for a provider kind (empty when none are known). */
export function defaultModelsFor(kind: ProviderKind): string[] {
  return [...(DEFAULT_MODELS_BY_KIND[kind] ?? [])];
}
