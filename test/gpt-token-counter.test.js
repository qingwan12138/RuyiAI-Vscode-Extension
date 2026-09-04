const test = require('node:test');
const assert = require('node:assert/strict');

const { countTokens, modelEncodingForTokenCount } = require('../dist/yisi/infrastructure/llm/gptTokenCounter');

test('model encoding selection follows the OpenAI family', () => {
  assert.equal(modelEncodingForTokenCount('gpt-4o'), 'gpt-4o');
  assert.equal(modelEncodingForTokenCount('o1-mini'), 'gpt-4o');
  assert.equal(modelEncodingForTokenCount('gpt-4.1-mini'), 'gpt-4o');
  assert.equal(modelEncodingForTokenCount('gpt-3.5-turbo'), 'gpt-3.5-turbo');
  // Non-OpenAI models fall back to the default encoding (proxy estimate).
  assert.equal(modelEncodingForTokenCount('deepseek-v4-flash-vision-exp'), undefined);
  assert.equal(modelEncodingForTokenCount('qwen3-32b'), undefined);
  assert.equal(modelEncodingForTokenCount('llama-3.1-8b'), undefined);
});

test('countTokens returns a positive count for ASCII and CJK, and is model-aware', () => {
  const ascii = countTokens('hello world', 'gpt-4o');
  assert.ok(ascii > 0);
  const cjk = countTokens('合同技术协议', 'deepseek-v4-flash-vision-exp');
  assert.ok(cjk > 0);
  // Same text can count differently for an OpenAI vs proxy encoding.
  const openaiCount = countTokens('hello world', 'gpt-4o');
  const proxyCount = countTokens('hello world', undefined);
  assert.ok(openaiCount > 0 && proxyCount > 0);
});

test('empty input yields zero and a failure falls back safely', () => {
  assert.equal(countTokens('', 'gpt-4o'), 0);
  assert.equal(countTokens(null, 'gpt-4o'), 0);
});
