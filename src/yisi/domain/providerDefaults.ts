import { ProviderKind } from './providerConfiguration';

/**
 * The models Yisi knows by name, per provider kind. Kept in the domain so the
 * naming stays centralized and unit-testable instead of being hard-coded in the
 * vscode wizard or the Webview.
 *
 * `current` entries are the provider's official lineup. `legacy` entries are
 * retired ids the provider still accepts, and `servedBy` names the current
 * model that actually answers for them — the user should be able to see that,
 * rather than have the id silently disappear from the picker.
 *
 * DeepSeek (official Models & Pricing table): the current lineup is
 * `deepseek-flash` (DeepSeek-V4.1-Flash, the vision-capable one) and
 * `deepseek-v4-pro` (no vision). `deepseek-v4-flash` and
 * `deepseek-v4-flash-vision-exp` are retired; `GET /models` no longer lists them
 * but the API still accepts them and serves them from DeepSeek-V4.1-Flash at the
 * Flash price.
 */
export interface KnownModelEntry {
  id: string;
  status: 'current' | 'legacy';
  /** For a legacy id: the current model that serves those requests. */
  servedBy?: string;
}

const KNOWN_MODELS: Readonly<Partial<Record<ProviderKind, readonly KnownModelEntry[]>>> = {
  deepseek: [
    { id: 'deepseek-flash', status: 'current' },
    { id: 'deepseek-v4-pro', status: 'current' },
    { id: 'deepseek-v4-flash', status: 'legacy', servedBy: 'deepseek-flash' },
    { id: 'deepseek-v4-flash-vision-exp', status: 'legacy', servedBy: 'deepseek-flash' }
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', status: 'current' },
    { id: 'claude-opus-4-5', status: 'current' },
    { id: 'claude-haiku-4-5', status: 'current' }
  ]
};

/** Known models for a provider kind (empty when none are known). */
export function knownModelsFor(kind: ProviderKind): KnownModelEntry[] {
  return (KNOWN_MODELS[kind] ?? []).map(entry => ({ ...entry }));
}

/**
 * The ids the wizard seeds a provider with, and the fallback roster when the
 * provider cannot be queried: the official lineup first, then the legacy ids it
 * still accepts.
 */
export function defaultModelsFor(kind: ProviderKind): string[] {
  return knownModelsFor(kind).map(entry => entry.id);
}

/**
 * Union of the known roster and what the endpoint reported, known ids first.
 *
 * Discovery must not simply replace: DeepSeek's `GET /models` lists only the two
 * current models, so replacing hides the retired ids the API still accepts (the
 * same ids DeepSeek's own harness offers). Unknown ids the endpoint reports are
 * appended in the order it returned them.
 */
export function mergeDiscoveredModels(kind: ProviderKind, discovered: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...defaultModelsFor(kind), ...(discovered ?? [])]) {
    const id = typeof candidate === 'string' ? candidate.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}
