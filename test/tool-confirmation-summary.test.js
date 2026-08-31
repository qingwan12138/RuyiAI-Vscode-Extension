const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeToolConfirmation } = require('../dist/yisi/vscode/agent/toolConfirmationSummary');

test('summarizes only the bounded replace-text approval surface', () => {
  const summary = summarizeToolConfirmation({
    callId: 'c1',
    toolId: 'replace_text',
    input: { path: 'src/main.ts', oldText: 'old\nline', newText: 'x'.repeat(1_000) },
    reason: 'Manual approval required.'
  });

  assert.match(summary.message, /src\/main\.ts/);
  assert.match(summary.detail, /old\\nline/);
  assert.match(summary.detail, /Manual approval required/);
  assert.ok(summary.detail.length < 900);
  assert.equal(summarizeToolConfirmation({
    callId: 'c2', toolId: 'run_command', input: {}, reason: 'no'
  }), undefined);
});
