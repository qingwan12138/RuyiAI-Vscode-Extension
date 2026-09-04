const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeContextUsage,
  estimateTokens,
  CHARS_PER_TOKEN,
  CONTEXT_OVERHEAD_TOKENS
} = require('../dist/yisi/application/context/contextUsage');

test('estimates CJK at ~1 token and ASCII at ~1/4 token', () => {
  const cjk = estimateTokens('合同');
  assert.equal(cjk, 2);
  const ascii = estimateTokens('hello');
  assert.equal(ascii, Math.ceil(5 / CHARS_PER_TOKEN)); // 2
  const mixed = estimateTokens('RISC-V 合同');
  // 'RISC-V ' = 7 non-CJK -> ceil(7/4)=2 ; 合同 = 2
  assert.equal(mixed, 4);
});

test('estimates tokens and clamps the percent to 100', () => {
  const usage = computeContextUsage(100, 1000);
  assert.equal(usage.supported, true);
  assert.equal(usage.usedTokens, 100);
  assert.equal(usage.percent, 10);
  assert.equal(computeContextUsage(20_000, 1000).percent, 100);
});

test('degrades to unsupported when the model context window is unknown', () => {
  assert.equal(computeContextUsage(1000, 0).supported, false);
  assert.equal(computeContextUsage(1000, undefined).supported, false);
});

test('applies a fixed shared overhead constant', () => {
  assert.ok(CONTEXT_OVERHEAD_TOKENS > 0);
});
