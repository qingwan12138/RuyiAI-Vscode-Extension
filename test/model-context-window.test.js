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

test('covers other families used by the same provider API', () => {
  assert.equal(modelContextWindow('openaiCompatible', 'qwen3-32b'), 128_000);
  assert.equal(modelContextWindow('openaiCompatible', 'llama-3.1-70b'), 128_000);
  assert.equal(modelContextWindow('openaiCompatible', 'glm-4.5'), 128_000);
  assert.equal(modelContextWindow('openaiCompatible', 'kimi-k2'), 128_000);
});

test('configured contextLength and user overrides win over the heuristic', () => {
  assert.equal(modelContextWindow('deepseek', 'custom-model', 32_768), 32_768);
  const overrides = [{ model: 'flash', windowTokens: 262_144 }];
  assert.equal(modelContextWindow('openaiCompatible', 'my-flash-x', undefined, overrides), 262_144);
  assert.equal(modelContextWindow('openaiCompatible', 'other-model', undefined, overrides), undefined);
});

test('unknown models without a configured length are undefined', () => {
  assert.equal(modelContextWindow('openaiCompatible', 'my-local-model'), undefined);
  assert.equal(modelContextWindow('llamaCpp', 'some-local-llm'), undefined);
  assert.equal(modelContextWindow('openai', ''), undefined);
});
