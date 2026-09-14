import { ProviderKind } from './providerConfiguration';

/**
 * Suggested model ids per provider kind, used as the initial model list before
 * (and as a fallback when) remote discovery runs. Kept in the domain so the
 * naming stays centralized and unit-testable instead of being hard-coded in the
 * vscode wizard or the Webview.
 *
 * DeepSeek: the official Models & Pricing table lists exactly two current
 * models — `deepseek-flash` (DeepSeek-V4.1-Flash, the vision-capable one) and
 * `deepseek-v4-pro` (no vision). `deepseek-v4-flash`,
 * `deepseek-v4-flash-vision-exp`, `deepseek-chat` and `deepseek-reasoner` were
 * retired; the API still accepts them but serves them from DeepSeek-V4.1-Flash,
 * so they are not offered as new choices. Discovery replaces this list whenever
 * the endpoint answers, so it matters on the fallback path (unreachable
 * endpoint, or "save without models").
 */
export const DEFAULT_MODELS_BY_KIND: Readonly<Partial<Record<ProviderKind, readonly string[]>>> = {
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5']
};

/** Default model ids for a provider kind (empty when none are known). */
export function defaultModelsFor(kind: ProviderKind): string[] {
  return [...(DEFAULT_MODELS_BY_KIND[kind] ?? [])];
}
