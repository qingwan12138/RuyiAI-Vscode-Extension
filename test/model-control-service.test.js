const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderConfigurationService } = require('../dist/yisi/application/provider/providerConfigurationService');
const { SessionService } = require('../dist/yisi/application/session/sessionService');
const { ModelControlService } = require('../dist/yisi/application/modelControl/modelControlService');

class MemoryRepository {
  async load() { return this.document && structuredClone(this.document); }
  async save(document) { this.document = structuredClone(document); }
}

class MemoryConfigRepository {
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

function providerInput(overrides = {}) {
  return {
    kind: 'openaiCompatible',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    credential: { source: 'none' },
    models: ['deepseek-chat', 'deepseek-reasoner'],
    capabilities: {
      toolCalling: true,
      temperature: true,
      maxTokens: true,
      speedMode: true,
      reasoning: {
        mode: 'effort',
        presets: ['auto', 'low', 'medium', 'high'],
        defaultPreset: 'auto'
      }
    },
    ...overrides
  };
}

async function createHarness(environment = {}) {
  const configRepository = new MemoryConfigRepository();
  const secrets = new MemorySecrets();
  let providerId = 0;
  const configurations = new ProviderConfigurationService(configRepository, secrets, {
    createId: () => `provider-${++providerId}`,
    now: () => 100 + providerId
  });
  await configurations.initialize();

  const sessions = new SessionService(new MemoryRepository(), {
    now: () => 1,
    createId: () => `session-1`
  });
  await sessions.initialize('workspace-a', []);

  const service = new ModelControlService(configurations, sessions, environment);
  return { configurations, secrets, sessions, service };
}

test('groups configured models by provider with their capabilities', async () => {
  const { configurations, service } = await createHarness();
  const created = await configurations.create(providerInput(), undefined);

  const state = await service.getState();

  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].id, created.id);
  assert.equal(state.providers[0].name, 'DeepSeek');
  assert.equal(state.providers[0].configured, true);
  assert.deepEqual(state.providers[0].models.map(model => model.id), ['deepseek-chat', 'deepseek-reasoner']);
  assert.deepEqual(state.providers[0].models[0].capabilities, {
    reasoningMode: 'effort',
    reasoningPresets: ['auto', 'low', 'medium', 'high'],
    reasoningDefault: 'auto',
    speedMode: true,
    temperature: true,
    maxTokens: true,
    contextLength: undefined
  });
});

test('marks the current model available with a display name', async () => {
  const { configurations, sessions, service } = await createHarness();
  const created = await configurations.create(providerInput(), undefined);
  await sessions.setModelSelection({ providerId: created.id, modelId: 'deepseek-chat' });
  await sessions.setReasoningEffort('medium');

  const state = await service.getState();

  assert.equal(state.current.providerId, created.id);
  assert.equal(state.current.modelId, 'deepseek-chat');
  assert.equal(state.current.available, true);
  assert.equal(state.current.displayName, 'deepseek-chat');
  assert.equal(state.current.reasoningEffort, 'medium');
});

test('marks a stale session model unavailable without silent fallback', async () => {
  const { configurations, sessions, service } = await createHarness();
  await configurations.create(providerInput(), undefined);
  await sessions.setModelSelection({ providerId: 'removed-provider', modelId: 'deepseek-chat' });

  const state = await service.getState();

  assert.equal(state.current.available, false);
  assert.equal(state.current.displayName, 'deepseek-chat');
});

test('marks an unselected session as needing a choice', async () => {
  const { service } = await createHarness();

  const state = await service.getState();

  assert.equal(state.current.available, false);
  assert.equal(state.current.displayName, '选择模型');
});

test('reflects credential configuration without exposing secrets', async () => {
  const { configurations, secrets, service } = await createHarness();
  await configurations.create(
    providerInput({ name: 'Local', credential: { source: 'none' } }),
    undefined
  );
  const keyed = await configurations.create(
    providerInput({ name: 'Keyed', models: ['m'], credential: { source: 'secretStorage' } }),
    'top-secret'
  );
  const missing = await configurations.create(
    providerInput({ name: 'Missing', models: ['m'], credential: { source: 'secretStorage' } }),
    'will-be-removed'
  );
  await secrets.delete(`yisiAI.provider.${missing.id}.apiKey`);

  const state = await service.getState();
  const byName = Object.fromEntries(state.providers.map(provider => [provider.name, provider.configured]));

  assert.equal(byName['Local'], true);
  assert.equal(byName['Keyed'], true);
  assert.equal(byName['Missing'], false);
  assert.equal(JSON.stringify(state).includes('top-secret'), false);
});

test('checks environment credentials against the extension host environment', async () => {
  const { configurations, service } = await createHarness({ DEEPSEEK_KEY: 'sk-live' });
  await configurations.create(
    providerInput({
      name: 'Env',
      models: ['m'],
      credential: { source: 'environment', variableName: 'DEEPSEEK_KEY' }
    }),
    undefined
  );
  await configurations.create(
    providerInput({
      name: 'MissingEnv',
      models: ['m'],
      credential: { source: 'environment', variableName: 'NOT_SET' }
    }),
    undefined
  );

  const state = await service.getState();
  const byName = Object.fromEntries(state.providers.map(provider => [provider.name, provider.configured]));

  assert.equal(byName['Env'], true);
  assert.equal(byName['MissingEnv'], false);
});

test('two providers may expose the same model id without conflict', async () => {
  const { configurations, sessions, service } = await createHarness();
  const primary = await configurations.create(
    providerInput({ name: 'DeepSeek 主账号', models: ['deepseek-chat'] }),
    undefined
  );
  const company = await configurations.create(
    providerInput({ name: '公司 API', models: ['deepseek-chat', 'qwen3-coder'] }),
    undefined
  );
  await sessions.setModelSelection({ providerId: primary.id, modelId: 'deepseek-chat' });

  const state = await service.getState();

  assert.equal(state.providers.length, 2);
  assert.equal(state.current.providerId, primary.id);
  assert.equal(state.current.modelId, 'deepseek-chat');
  const companyModels = state.providers.find(provider => provider.id === company.id).models;
  assert.equal(companyModels.filter(model => model.id === 'deepseek-chat').length, 1);
  assert.equal(companyModels.filter(model => model.id === 'qwen3-coder').length, 1);
});

test('fixed reasoning models do not surface a preset list in the UI', async () => {
  const { configurations, sessions, service } = await createHarness();
  const reasoner = await configurations.create(
    providerInput({
      kind: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek-reasoner', 'deepseek-chat'],
      credential: { source: 'environment', variableName: 'DS_KEY' }
    }),
    undefined
  );
  await sessions.setModelSelection({ providerId: reasoner.id, modelId: 'deepseek-reasoner' });

  const state = await service.getState();

  assert.equal(state.current.capabilities.reasoningMode, 'fixed');
  assert.deepEqual(state.current.capabilities.reasoningPresets, []);
});

test('retired DeepSeek ids are listed and marked with the model that serves them', async () => {
  const { configurations, service } = await createHarness();
  await configurations.create(
    providerInput({
      kind: 'deepseek',
      name: 'DeepSeek',
      models: [
        'deepseek-flash',
        'deepseek-v4-pro',
        'deepseek-v4-flash',
        'deepseek-v4-flash-vision-exp'
      ],
      // The deepseek kind requires a credential source.
      credential: { source: 'environment', variableName: 'DS_KEY' }
    }),
    undefined
  );

  const state = await service.getState();
  const models = state.providers[0].models;

  // All four stay selectable, so a session already bound to a retired id keeps
  // working and the user can see what the retired names route to.
  assert.deepEqual(models.map(model => model.id), [
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp'
  ]);
  // Current models carry no marker.
  assert.equal(models[0].legacyOf, undefined);
  assert.equal(models[1].legacyOf, undefined);
  // Retired ids name the current model that actually serves the request.
  assert.equal(models[2].legacyOf, 'deepseek-flash');
  assert.equal(models[3].legacyOf, 'deepseek-flash');
});

test('a stored two-model DeepSeek config still offers the retired ids', async () => {
  // Reproduces the reported picker: the provider was saved back when discovery
  // reported only the two current models. The retired ids must appear anyway,
  // and choosing one must count as available, without rewriting what is stored.
  const { configurations, sessions, service } = await createHarness();
  const created = await configurations.create(
    providerInput({
      kind: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      credential: { source: 'environment', variableName: 'DS_KEY' }
    }),
    undefined
  );

  const state = await service.getState();

  assert.deepEqual(state.providers[0].models.map(model => model.id), [
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp'
  ]);
  assert.equal(state.providers[0].models[2].legacyOf, 'deepseek-flash');
  assert.equal(state.providers[0].models[3].legacyOf, 'deepseek-flash');

  // The roster is merged on read: the saved configuration itself is untouched,
  // so the extension never silently rewrites a user's provider entry.
  assert.deepEqual(configurations.get(created.id).models, ['deepseek-flash', 'deepseek-v4-pro']);

  // A retired id is genuinely selectable, not just displayed.
  await sessions.setModelSelection({ providerId: created.id, modelId: 'deepseek-v4-flash' });
  const after = await service.getState();
  assert.equal(after.current.modelId, 'deepseek-v4-flash');
  assert.equal(after.current.available, true);
});
