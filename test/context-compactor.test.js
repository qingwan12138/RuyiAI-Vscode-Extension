const test = require('node:test');
const assert = require('node:assert/strict');

const { compactHistory } = require('../dist/yisi/application/context/contextCompactor');
const { estimateTokens } = require('../dist/yisi/application/context/contextUsage');

function msg(role, text) { return { role, text }; }

test('does not compact when history fits the budget', () => {
  const history = [msg('user', 'short'), msg('assistant', 'ok')];
  const compacted = compactHistory(history, 5000);
  assert.equal(compacted.note, null);
  assert.equal(compacted.droppedCount, 0);
  assert.deepEqual(compacted.messages, history);
});

test('drops the oldest messages to fit a small budget, retaining the tail', () => {
  const history = [
    msg('user', 'A'.repeat(400)),
    msg('assistant', 'B'.repeat(400)),
    msg('user', 'C'.repeat(400)),
    msg('assistant', 'D'.repeat(400))
  ];
  const compacted = compactHistory(history, 40);
  assert.ok(compacted.note, 'should note the dropped history');
  assert.ok(compacted.droppedCount > 0);
  assert.ok(compacted.messages.length >= 1, 'at least the newest turn is retained');
  // Retained messages are a suffix of the original history.
  assert.deepEqual(compacted.messages, history.slice(compacted.droppedCount));
});

test('handles an empty history and a pathological huge single message without crashing', () => {
  assert.deepEqual(compactHistory([], 100), { messages: [], note: null, droppedCount: 0 });
  const giant = [msg('user', 'z'.repeat(1000000))]; // estimateTokens is bounded
  const compacted = compactHistory(giant, 10);
  assert.ok(Array.isArray(compacted.messages));
  assert.ok(compacted.droppedCount >= 0);
  assert.ok(compacted.note === null || typeof compacted.note === 'string');
});
