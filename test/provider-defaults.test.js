const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultModelsFor, DEFAULT_MODELS_BY_KIND } = require('../dist/yisi/domain/providerDefaults');
const { modelContextWindow } = require('../dist/yisi/domain/modelContextWindow');
const { modelSupportsVision } = require('../dist/yisi/domain/modelCapabilities');

test('DeepSeek suggests the current V4 lineup plus the previous-generation fallbacks', () => {
  const models = defaultModelsFor('deepseek');
  assert.ok(models.includes('deepseek-v4-pro'), 'V4 Pro');
  assert.ok(models.includes('deepseek-v4-flash'), 'V4 Flash');
  assert.ok(models.includes('deepseek-v4-flash-vision-exp'), 'V4 Flash vision');
  assert.ok(models.includes('deepseek-chat'), 'previous-gen chat');
  assert.ok(models.includes('deepseek-reasoner'), 'previous-gen reasoner');
  assert.ok(DEFAULT_MODELS_BY_KIND.deepseek.length > 0);
});

test('every suggested DeepSeek model resolves a sane context window', () => {
  for (const id of defaultModelsFor('deepseek')) {
    const window = modelContextWindow('deepseek', id);
    assert.ok(typeof window === 'number' && window > 0, `${id} should resolve a window`);
  }
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-pro'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash-vision-exp'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-chat'), 64_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-reasoner'), 64_000);
});

test('only the vision variant of the DeepSeek lineup accepts images', () => {
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-flash-vision-exp'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-flash'), false);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro'), false);
});

test('unknown kinds suggest nothing and callers get a defensive copy', () => {
  assert.deepEqual(defaultModelsFor('llamaCpp'), []);
  assert.deepEqual(defaultModelsFor('openaiCompatible'), []);
  const copy = defaultModelsFor('deepseek');
  copy.push('injected');
  assert.equal(defaultModelsFor('deepseek').includes('injected'), false);
});
