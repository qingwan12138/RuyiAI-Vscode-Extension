import { SessionModelSelection } from './session';

export type ProviderKind = 'openai' | 'openaiCompatible';
export type CredentialSource =
  | { source: 'secretStorage' }
  | { source: 'environment'; variableName: string }
  | { source: 'none' };

export interface ProviderConfigurationInput {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  credential: CredentialSource;
  models: string[];
}

export interface ProviderConfiguration extends ProviderConfigurationInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderConfigurationDocument {
  schemaVersion: 1;
  configurations: ProviderConfiguration[];
}

export class ProviderConfigurationSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationSchemaError';
  }
}

export function createProviderConfiguration(
  id: string,
  now: number,
  input: ProviderConfigurationInput
): ProviderConfiguration {
  const name = input.name.trim();
  if (!id.trim() || !name) throw invalid('Provider id and name are required.');
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.kind);
  const credential = parseCredential(input.credential);
  if (input.kind === 'openai' && credential.source === 'none') {
    throw invalid('OpenAI configuration requires a credential.');
  }
  const models = [...new Set(input.models.map(model => model.trim()).filter(Boolean))];
  if (models.length === 0) throw invalid('At least one model is required.');
  if (!Number.isFinite(now) || now < 0) throw invalid('Provider timestamp is invalid.');
  return { id, kind: input.kind, name, baseUrl, credential, models, createdAt: now, updatedAt: now };
}

export function parseProviderConfigurationDocument(value: unknown): ProviderConfigurationDocument {
  if (!isRecord(value) || !hasKeys(value, ['schemaVersion', 'configurations']) || value.schemaVersion !== 1 || !Array.isArray(value.configurations)) {
    throw invalid('Malformed provider configuration document.');
  }
  return {
    schemaVersion: 1,
    configurations: value.configurations.map(parseConfiguration)
  };
}

export function parseModelSelection(value: unknown): SessionModelSelection | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasKeys(value, ['providerId', 'modelId']) || typeof value.providerId !== 'string' || typeof value.modelId !== 'string') {
    throw invalid('Malformed provider model selection.');
  }
  return { providerId: value.providerId, modelId: value.modelId };
}

function parseConfiguration(value: unknown): ProviderConfiguration {
  if (!isRecord(value) || !hasKeys(value, ['id', 'kind', 'name', 'baseUrl', 'credential', 'models', 'createdAt', 'updatedAt'])) {
    throw invalid('Malformed provider configuration.');
  }
  if (
    typeof value.id !== 'string'
    || (value.kind !== 'openai' && value.kind !== 'openaiCompatible')
    || typeof value.name !== 'string'
    || typeof value.baseUrl !== 'string'
    || !Array.isArray(value.models)
    || !value.models.every(model => typeof model === 'string')
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
  ) {
    throw invalid('Malformed provider configuration.');
  }
  const configuration = createProviderConfiguration(value.id, value.createdAt, {
    kind: value.kind,
    name: value.name,
    baseUrl: value.baseUrl,
    credential: parseCredential(value.credential),
    models: value.models
  });
  if (!Number.isFinite(value.updatedAt) || value.updatedAt < configuration.createdAt) throw invalid('Provider timestamp is invalid.');
  configuration.updatedAt = value.updatedAt;
  return configuration;
}

function parseCredential(value: unknown): CredentialSource {
  if (!isRecord(value) || typeof value.source !== 'string') throw invalid('Malformed credential source.');
  if (value.source === 'secretStorage' && hasKeys(value, ['source'])) return { source: 'secretStorage' };
  if (value.source === 'none' && hasKeys(value, ['source'])) return { source: 'none' };
  if (
    value.source === 'environment'
    && hasKeys(value, ['source', 'variableName'])
    && typeof value.variableName === 'string'
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.variableName)
  ) {
    return { source: 'environment', variableName: value.variableName };
  }
  throw invalid('Malformed credential source.');
}

function normalizeBaseUrl(raw: string, kind: ProviderKind): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw invalid('Provider base URL is invalid.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Provider base URL must use HTTP or HTTPS.');
  if (kind === 'openai' && url.protocol !== 'https:') throw invalid('OpenAI base URL must use HTTPS.');
  if (url.username || url.password || url.search || url.hash) throw invalid('Provider base URL must not contain credentials, query, or fragment.');
  return url.toString().replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalid(message: string): ProviderConfigurationSchemaError {
  return new ProviderConfigurationSchemaError(message);
}
