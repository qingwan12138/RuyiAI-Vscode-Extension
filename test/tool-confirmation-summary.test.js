const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeToolConfirmation } = require('../dist/yisi/vscode/agent/toolConfirmationSummary');

test('summarizes the bounded replace-text approval surface', () => {
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
});

test('summarizes the exclusive create-text-file approval surface', () => {
  const create = summarizeToolConfirmation({
    callId: 'c-create', toolId: 'create_text_file',
    input: { path: 'src/new.ts', content: 'export const value = 1;\n' },
    reason: 'Manual approval required.'
  });
  assert.match(create.message, /Create.*src\/new\.ts/);
  assert.match(create.detail, /export const value/);
});

test('run_command always produces an actionable approval summary (never a silent decline)', () => {
  const summary = summarizeToolConfirmation({
    callId: 'c-run',
    toolId: 'run_command',
    input: { executable: 'node', args: ['--test', 'calc.test.mjs'] },
    reason: 'Manual approval required.'
  });
  assert.match(summary.message, /Run the proposed command/);
  assert.match(summary.detail, /\$ node --test calc\.test\.mjs/);
  assert.match(summary.detail, /Manual approval required/);
});

test('every other permission-gated tool gets a real summary', () => {
  const cases = [
    { toolId: 'rewrite_text_file', input: { path: 'a.txt', expectedSha256: 'a'.repeat(64), content: 'x' }, want: /Replace the whole content of a\.txt/ },
    { toolId: 'delete_file', input: { path: 'old.txt' }, want: /Delete old\.txt/ },
    { toolId: 'create_directory', input: { path: 'tests/' }, want: /Create directory tests/ },
    { toolId: 'rename_file', input: { fromPath: 'a.txt', toPath: 'b.txt' }, want: /Move a\.txt to b\.txt/ },
    { toolId: 'undo_last_edit', input: {}, want: /Undo the agent's last workspace edit/ },
    { toolId: 'run_validations', input: { executable: 'npm', args: ['test'] }, want: /Run the proposed project validations/ }
  ];
  for (const entry of cases) {
    const summary = summarizeToolConfirmation({
      callId: 'c-' + entry.toolId,
      toolId: entry.toolId,
      input: entry.input,
      reason: 'Manual approval required.'
    });
    assert.match(summary.message, entry.want, `${entry.toolId} message`);
    assert.match(summary.detail, /Manual approval required/, `${entry.toolId} detail`);
  }
});

test('unknown future gated tools fall back to a generic but actionable summary', () => {
  const summary = summarizeToolConfirmation({
    callId: 'c-future',
    toolId: 'future_experimental_tool',
    input: { alpha: 1, beta: [true, 'x'] },
    reason: 'Manual approval required.'
  });
  assert.match(summary.message, /future_experimental_tool/);
  assert.match(summary.detail, /alpha/);
});
