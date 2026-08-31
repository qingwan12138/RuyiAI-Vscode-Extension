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
  capabilities: ProviderCapabilities;
}

export interface ProviderCapabilities {
  toolCalling: boolean;
}

export interface ProviderConfiguration extends ProviderConfigurationInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderConfigurationDocument {
  schemaVersion: 2;
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
  const capabilities = parseCapabilities(input.capabilities);
  return { id, kind: input.kind, name, baseUrl, credential, models, capabilities, createdAt: now, updatedAt: now };
}

export function parseProviderConfigurationDocument(value: unknown): ProviderConfigurationDocument {
  if (!isRecord(value) || !hasKeys(value, ['schemaVersion', 'configurations']) || !Array.isArray(value.configurations)) {
    throw invalid('Malformed provider configuration document.');
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw invalid('Malformed provider configuration document.');
  const legacy = value.schemaVersion === 1;
  return {
    schemaVersion: 2,
    configurations: value.configurations.map(item => parseConfiguration(item, legacy))
  };
}

export function parseModelSelection(value: unknown): SessionModelSelection | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasKeys(value, ['providerId', 'modelId']) || typeof value.providerId !== 'string' || typeof value.modelId !== 'string') {
    throw invalid('Malformed provider model selection.');
  }
  return { providerId: value.providerId, modelId: value.modelId };
}

function parseConfiguration(value: unknown, legacy: boolean): ProviderConfiguration {
  const keys = legacy
    ? ['id', 'kind', 'name', 'baseUrl', 'credential', 'models', 'createdAt', 'updatedAt']
    : ['id', 'kind', 'name', 'baseUrl', 'credential', 'models', 'capabilities', 'createdAt', 'updatedAt'];
  if (!isRecord(value) || !hasKeys(value, keys)) {
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
    models: value.models,
    capabilities: legacy ? { toolCalling: false } : parseCapabilities(value.capabilities)
  });
  if (!Number.isFinite(value.updatedAt) || value.updatedAt < configuration.createdAt) throw invalid('Provider timestamp is invalid.');
  configuration.updatedAt = value.updatedAt;
  return configuration;
}

function parseCapabilities(value: unknown): ProviderCapabilities {
  if (!isRecord(value) || !hasKeys(value, ['toolCalling']) || typeof value.toolCalling !== 'boolean') {
    throw invalid('Malformed provider capabilities.');
  }
  return { toolCalling: value.toolCalling };
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
