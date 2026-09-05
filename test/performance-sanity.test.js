const test = require('node:test');
const assert = require('node:assert/strict');

const { estimateTokens } = require('../dist/yisi/application/context/contextUsage');
const { compactHistory } = require('../dist/yisi/application/context/contextCompactor');
const { parsePorcelain } = require('../dist/yisi/infrastructure/git/nodeGitService');
const { parsePorcelainRecords } = require('../dist/yisi/ruyi/ruyiCliAdapter');

test('bounded context/git operations stay fast on pathological inputs', () => {
  const started = Date.now();

  // estimateTokens over ~1M chars (bounded, no quadratic blowup).
  for (let i = 0; i < 10; i += 1) estimateTokens('x'.repeat(100_000));

  // Compaction over 2000 history messages.
  const messages = Array.from({ length: 2000 }, (_, i) => ({ role: 'user', text: `payload ${i} `.repeat(20) }));
  compactHistory(messages, 500);

  // Git porcelain parsing of a large status buffer.
  const porcelain = Array.from({ length: 5000 }, (_, i) => ` M src/f${i}.ts`).join('\n');
  parsePorcelain(`## main\n${porcelain}\n`);

  // Ruyi porcelain records over many JSON lines.
  parsePorcelainRecords(Array.from({ length: 5000 }, (_, i) => `{"id":"pkg-${i}"}`).join('\n'));

  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `bounded ops should stay under 5s, took ${elapsed}ms`);
});
