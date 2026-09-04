const test = require('node:test');
const assert = require('node:assert/strict');

const { modelContextWindow } = require('../dist/yisi/domain/modelContextWindow');

test('returns known family window sizes by prefix', () => {
  assert.equal(modelContextWindow('openai', 'gpt-4o-2024-08-06'), 128_000);
  assert.equal(modelContextWindow('openai', 'gpt-4.1-mini'), 1_000_000);
  assert.equal(modelContextWindow('openai', 'o1-preview'), 200_000);
  assert.equal(modelContextWindow('anthropic', 'claude-sonnet-4-5'), 200_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash-vision-exp'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-chat'), 64_000);
});

test('configured contextLength wins over the heuristic', () => {
  assert.equal(modelContextWindow('deepseek', 'custom-model', 32_768), 32_768);
});

test('unknown models without a configured length are undefined', () => {
  assert.equal(modelContextWindow('openaiCompatible', 'my-local-model'), undefined);
  assert.equal(modelContextWindow('llamaCpp', 'llama-3.1-8b'), undefined);
  assert.equal(modelContextWindow('openai', ''), undefined);
});

test('unknown family falls back to a positive default only for known kinds', () => {
  assert.equal(modelContextWindow('deepseek', 'my-unknown-model'), 64_000);
  assert.equal(modelContextWindow('openai', 'some-new-gpt'), undefined);
});
