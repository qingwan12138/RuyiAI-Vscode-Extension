const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderCatalog, ProviderUnavailableError } = require('../dist/yisi/application/provider/providerCatalog');

function config(credential) {
  return { id: 'p1', kind: 'openaiCompatible', name: 'Provider', baseUrl: 'https://example.com/v1', credential, models: ['m1'], createdAt: 1, updatedAt: 1 };
}

test('resolves SecretStorage, environment, and credential-free providers', async () => {
  for (const [credential, secretValue, environment, expected] of [
    [{ source: 'secretStorage' }, 'stored-key', {}, 'stored-key'],
    [{ source: 'environment', variableName: 'MODEL_KEY' }, undefined, { MODEL_KEY: 'env-key' }, 'env-key'],
    [{ source: 'none' }, undefined, {}, undefined]
  ]) {
    let received;
    const catalog = new ProviderCatalog(
      { get: () => config(credential) },
      { get: async () => secretValue },
      environment,
      { create: (configuration, apiKey) => (received = { configuration, apiKey }) }
    );
    await catalog.resolve('p1');
    assert.equal(received.apiKey, expected);
  }
});

test('rejects missing providers and missing configured credentials', async () => {
  const missing = new ProviderCatalog({ get: () => undefined }, { get: async () => undefined }, {}, { create: () => ({}) });
  await assert.rejects(() => missing.resolve('missing'), ProviderUnavailableError);
  const noSecret = new ProviderCatalog({ get: () => config({ source: 'secretStorage' }) }, { get: async () => undefined }, {}, { create: () => ({}) });
  await assert.rejects(() => noSecret.resolve('p1'), /credential is unavailable/);
});
