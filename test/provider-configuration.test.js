const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderConfigurationSchemaError,
  createProviderConfiguration,
  parseProviderConfigurationDocument
} = require('../dist/yisi/domain/providerConfiguration');
const {
  ProviderConfigurationService,
  providerSecretKey
} = require('../dist/yisi/application/provider/providerConfigurationService');

class MemoryRepository {
  async loadConfigurations() { return this.document && structuredClone(this.document); }
  async saveConfigurations(document) { this.document = structuredClone(document); }
  async loadWorkspaceDefault() { return this.selection && { ...this.selection }; }
  async saveWorkspaceDefault(selection) { this.selection = selection && { ...selection }; }
}

class MemorySecrets {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async set(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}

function input(overrides = {}) {
  return {
    kind: 'openaiCompatible',
    name: 'Local llama.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1/',
    credential: { source: 'none' },
    models: ['local-model'],
    capabilities: { toolCalling: false },
    ...overrides
  };
}

function serviceHarness() {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  let id = 0;
  const service = new ProviderConfigurationService(repository, secrets, {
    createId: () => `provider-${++id}`,
    now: () => 100 + id
  });
  return { repository, secrets, service };
}

test('normalizes compatible base URLs and model lists', () => {
  const configuration = createProviderConfiguration('provider-1', 100, input({ models: [' local-model ', 'local-model', ''] }));
  assert.equal(configuration.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.deepEqual(configuration.models, ['local-model']);
});

test('requires a credential and HTTPS for OpenAI configurations', () => {
  assert.throws(
    () => createProviderConfiguration('provider-1', 100, input({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', credential: { source: 'none' } })),
    /credential/
  );
  assert.throws(
    () => createProviderConfiguration('provider-1', 100, input({ kind: 'openai', baseUrl: 'http://api.openai.com/v1', credential: { source: 'environment', variableName: 'OPENAI_API_KEY' } })),
    /HTTPS/
  );
});

test('rejects malformed persisted configuration and secret-looking fields', () => {
  assert.throws(
    () => parseProviderConfigurationDocument({ schemaVersion: 1, configurations: [{ ...input(), id: 'p', createdAt: 1, updatedAt: 1, apiKey: 'secret' }] }),
    ProviderConfigurationSchemaError
  );
});

test('stores API keys separately from provider metadata', async () => {
  const { repository, secrets, service } = serviceHarness();
  await service.initialize();
  const created = await service.create(input({ credential: { source: 'secretStorage' } }), 'top-secret');

  assert.equal(await secrets.get(providerSecretKey(created.id)), 'top-secret');
  assert.equal(JSON.stringify(repository.document).includes('top-secret'), false);
  assert.equal(service.list().length, 1);
});

test('resolves existing session selection before workspace default', async () => {
  const { service } = serviceHarness();
  await service.initialize();
  const first = await service.create(input({ name: 'First', models: ['a'] }));
  const second = await service.create(input({ name: 'Second', models: ['b'] }));
  await service.setWorkspaceDefault({ providerId: second.id, modelId: 'b' });

  assert.deepEqual(service.resolveSelection({ providerId: first.id, modelId: 'a' }), { providerId: first.id, modelId: 'a' });
  assert.deepEqual(service.resolveSelection({ providerId: '', modelId: '' }), { providerId: second.id, modelId: 'b' });
  assert.equal(service.resolveSelection({ providerId: 'missing', modelId: 'x' }), undefined);
});

test('removing a provider clears its workspace default and stored secret', async () => {
  const { secrets, service } = serviceHarness();
  await service.initialize();
  const created = await service.create(input({ credential: { source: 'secretStorage' } }), 'top-secret');
  await service.setWorkspaceDefault({ providerId: created.id, modelId: 'local-model' });

  await service.remove(created.id);

  assert.equal(await secrets.get(providerSecretKey(created.id)), undefined);
  assert.equal(service.getWorkspaceDefault(), undefined);
});

test('migrates exact schema v1 configurations to disabled tool calling', () => {
  const legacy = {
    schemaVersion: 1,
    configurations: [{
      id: 'legacy',
      kind: 'openaiCompatible',
      name: 'Legacy',
      baseUrl: 'http://127.0.0.1:8080/v1',
      credential: { source: 'none' },
      models: ['model'],
      createdAt: 1,
      updatedAt: 2
    }]
  };

  const migrated = parseProviderConfigurationDocument(legacy);

  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.configurations[0].capabilities, { toolCalling: false });
});

test('creates and parses exact schema v2 tool capabilities', () => {
  const created = createProviderConfiguration('p1', 10, input({ capabilities: { toolCalling: true } }));
  assert.deepEqual(created.capabilities, { toolCalling: true });

  const parsed = parseProviderConfigurationDocument({ schemaVersion: 2, configurations: [created] });
  assert.deepEqual(parsed, { schemaVersion: 2, configurations: [created] });

  for (const capabilities of [
    {},
    { toolCalling: 'yes' },
    { toolCalling: true, apiKey: 'secret' }
  ]) {
    assert.throws(
      () => createProviderConfiguration('p1', 10, input({ capabilities })),
      ProviderConfigurationSchemaError
    );
  }
});
