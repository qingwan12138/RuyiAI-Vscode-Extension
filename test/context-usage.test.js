const test = require('node:test');
const assert = require('node:assert/strict');

const { computeContextUsage, CHARS_PER_TOKEN } = require('../dist/yisi/application/context/contextUsage');

test('estimates tokens at ~4 chars each and clamps the percent to 100', () => {
  const usage = computeContextUsage(100 * CHARS_PER_TOKEN, 1000);
  assert.equal(usage.supported, true);
  assert.equal(usage.usedTokens, 100);
  assert.equal(usage.percent, 10);

  const over = computeContextUsage(20_000 * CHARS_PER_TOKEN, 1000);
  assert.equal(over.percent, 100);
});

test('degrades to unsupported when the model context window is unknown', () => {
  const usage = computeContextUsage(1000, 0);
  assert.equal(usage.supported, false);
  assert.equal(usage.percent, 0);
  assert.equal(usage.usedTokens, 250);
  assert.equal(usage.maxTokens, undefined);

  const noWindow = computeContextUsage(1000, undefined);
  assert.equal(noWindow.supported, false);
});

test('negative length yields zero used tokens without throwing', () => {
  const usage = computeContextUsage(-50, 1000);
  assert.equal(usage.usedTokens, 0);
  assert.equal(usage.percent, 0);
});
