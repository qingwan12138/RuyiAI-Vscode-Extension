const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VsCodeProviderConfigurationRepository,
  PROVIDER_CONFIGURATIONS_KEY,
  WORKSPACE_DEFAULT_KEY
} = require('../dist/yisi/vscode/provider/vsCodeProviderConfigurationRepository');
const { VsCodeSecretStore } = require('../dist/yisi/vscode/provider/vsCodeSecretStore');

class MemoryMemento {
  constructor() { this.values = new Map(); }
  get(key) { return this.values.get(key); }
  async update(key, value) {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, structuredClone(value));
  }
}

class MemorySecretStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async store(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}

function document() {
  return {
    schemaVersion: 1,
    configurations: [{
      id: 'provider-1',
      kind: 'openaiCompatible',
      name: 'Local',
      baseUrl: 'http://127.0.0.1:8080/v1',
      credential: { source: 'none' },
      models: ['model-a'],
      createdAt: 1,
      updatedAt: 1
    }]
  };
}

function migratedDocument() {
  const legacy = document();
  return {
    schemaVersion: 2,
    configurations: [{ ...legacy.configurations[0], capabilities: { toolCalling: false } }]
  };
}

test('stores provider metadata globally and model defaults per workspace', async () => {
  const globalState = new MemoryMemento();
  const workspaceState = new MemoryMemento();
  const repository = new VsCodeProviderConfigurationRepository(globalState, workspaceState);

  await repository.saveConfigurations(document());
  await repository.saveWorkspaceDefault({ providerId: 'provider-1', modelId: 'model-a' });

  assert.deepEqual(globalState.get(PROVIDER_CONFIGURATIONS_KEY), migratedDocument());
  assert.equal(globalState.get(WORKSPACE_DEFAULT_KEY), undefined);
  assert.deepEqual(workspaceState.get(WORKSPACE_DEFAULT_KEY), { providerId: 'provider-1', modelId: 'model-a' });
  assert.deepEqual(await repository.loadConfigurations(), migratedDocument());
  assert.deepEqual(await repository.loadWorkspaceDefault(), { providerId: 'provider-1', modelId: 'model-a' });
});

test('validates persisted metadata and never puts secret values in mementos', async () => {
  const globalState = new MemoryMemento();
  const workspaceState = new MemoryMemento();
  const repository = new VsCodeProviderConfigurationRepository(globalState, workspaceState);
  globalState.values.set(PROVIDER_CONFIGURATIONS_KEY, {
    ...document(),
    configurations: [{ ...document().configurations[0], apiKey: 'must-not-survive' }]
  });

  await assert.rejects(repository.loadConfigurations(), /Malformed provider configuration/);
  assert.equal(JSON.stringify([...workspaceState.values]).includes('must-not-survive'), false);
});

test('wraps SecretStorage without exposing its values through provider metadata', async () => {
  const storage = new MemorySecretStorage();
  const secrets = new VsCodeSecretStore(storage);

  await secrets.set('opaque-key', 'top-secret');
  assert.equal(await secrets.get('opaque-key'), 'top-secret');
  await secrets.delete('opaque-key');
  assert.equal(await secrets.get('opaque-key'), undefined);
});

test('clears the workspace default with an undefined update', async () => {
  const workspaceState = new MemoryMemento();
  const repository = new VsCodeProviderConfigurationRepository(new MemoryMemento(), workspaceState);
  await repository.saveWorkspaceDefault({ providerId: 'p', modelId: 'm' });
  await repository.saveWorkspaceDefault(undefined);
  assert.equal(workspaceState.get(WORKSPACE_DEFAULT_KEY), undefined);
  assert.equal(await repository.loadWorkspaceDefault(), undefined);
});
