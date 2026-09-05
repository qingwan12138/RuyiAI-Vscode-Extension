const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeSessionHistory, createSessionHistoryTool } = require('../dist/yisi/application/context/sessionHistoryService');

test('summarizes turn counts and estimated tokens', () => {
  const items = [
    { id: 'u1', type: 'userMessage', text: 'hello', createdAt: 1, contexts: [] },
    { id: 'a1', type: 'assistantMessage', text: 'hi there', source: 'provider', createdAt: 2 }
  ];
  const report = summarizeSessionHistory(items);
  assert.equal(report.turnCount, 2);
  assert.equal(report.userTurns, 1);
  assert.equal(report.assistantTurns, 1);
  assert.ok(report.estimatedTokens > 0);
  assert.equal(report.truncated, false);
});

test('caps at maxTurns and reports truncation', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ id: 'u' + i, type: 'userMessage', text: 'x', createdAt: i, contexts: [] }));
  const report = summarizeSessionHistory(items, 200);
  assert.equal(report.turnCount, 200);
  assert.equal(report.truncated, true);
  assert.match(report.summary, /older turns omitted/);
});

test('session_history tool is read-only and falls back when no history', async () => {
  const tool = createSessionHistoryTool(async () => null);
  assert.equal(tool.id, 'session_history');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);
  const report = await tool.execute({}, { signal: new AbortController().signal });
  assert.match(report.summary, /No active session history/);
});
