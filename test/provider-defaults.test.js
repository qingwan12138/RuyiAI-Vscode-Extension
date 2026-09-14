const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultModelsFor, DEFAULT_MODELS_BY_KIND } = require('../dist/yisi/domain/providerDefaults');
const { modelContextWindow } = require('../dist/yisi/domain/modelContextWindow');
const { modelSupportsVision } = require('../dist/yisi/domain/modelCapabilities');

test('DeepSeek suggests the two current models from the official lineup table', () => {
  const models = defaultModelsFor('deepseek');
  // The retired ids (deepseek-v4-flash, deepseek-v4-flash-vision-exp,
  // deepseek-chat, deepseek-reasoner) are still accepted by the API but are
  // served from DeepSeek-V4.1-Flash, so they are not offered as new choices.
  assert.deepEqual(models, ['deepseek-flash', 'deepseek-v4-pro']);
  assert.ok(DEFAULT_MODELS_BY_KIND.deepseek.length > 0);
});

test('every suggested DeepSeek model resolves a sane context window', () => {
  for (const id of defaultModelsFor('deepseek')) {
    const window = modelContextWindow('deepseek', id);
    assert.ok(typeof window === 'number' && window > 0, `${id} should resolve a window`);
  }
  // Both current models are million-token context. `deepseek-flash` must not
  // fall through to the 64k legacy default just because its id has no `v4`.
  assert.equal(modelContextWindow('deepseek', 'deepseek-flash'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-pro'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash-vision-exp'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-chat'), 64_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-reasoner'), 64_000);
});

test('the DeepSeek vision model is recognized despite carrying no marker', () => {
  // Regression: `deepseek-flash` IS DeepSeek-V4.1-Flash, the vision-capable
  // model. The generic `vision`-marker heuristic cannot see that.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-flash'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro'), false);
  // Retired aliases are still accepted and served by V4.1-Flash.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-flash'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-flash-vision-exp'), true);
  // Dated variants inherit the family capability; an explicit marker still wins.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-flash-0813'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro-0813'), false);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro-vision'), true);
  // Unknown ids stay conservative.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-next'), false);
  // An explicit provider override always wins.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-flash', false), false);
});

test('unknown kinds suggest nothing and callers get a defensive copy', () => {
  assert.deepEqual(defaultModelsFor('llamaCpp'), []);
  assert.deepEqual(defaultModelsFor('openaiCompatible'), []);
  const copy = defaultModelsFor('deepseek');
  copy.push('injected');
  assert.equal(defaultModelsFor('deepseek').includes('injected'), false);
});
