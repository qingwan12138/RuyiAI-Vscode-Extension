const test = require('node:test');
const assert = require('node:assert/strict');

const {
  estimateTokens,
  computeAttachmentBudget,
  assembleAttachmentContexts,
  selectChunksWithinBudget,
  DEFAULT_ATTACHMENT_BUDGET
} = require('../dist/yisi/application/chat/attachmentPrompt');

function context(fileName, chunks) {
  return { id: fileName, fileName, kind: 'text', chunks, truncated: false, warnings: [] };
}

function chunk(id, text) {
  return { id, text };
}

test('estimateTokens counts ~4 characters per token', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2); // 5 chars rounds up
});

test('computeAttachmentBudget uses the absolute ceiling when no model context is advertised', () => {
  assert.equal(computeAttachmentBudget(undefined, '', ''), DEFAULT_ATTACHMENT_BUDGET.maxTokens);
  assert.equal(computeAttachmentBudget(0, '', ''), DEFAULT_ATTACHMENT_BUDGET.maxTokens);
});

test('computeAttachmentBudget reserves output and subtracts consumed conversation', () => {
  // 8000 window: 2000 output reserve leaves 6000 for history + attachments.
  assert.equal(computeAttachmentBudget(8000, '', ''), 6000);
  // 1000 chars of history (~250 tokens) shrinks the room accordingly.
  assert.equal(computeAttachmentBudget(8000, 'x'.repeat(1000), ''), 6000 - 250);
});

test('computeAttachmentBudget returns 0 when there is no room left', () => {
  // 2000 window: 500 output reserve + ~500 tokens of history/user leaves < minTokens.
  const filled = 'x'.repeat(2000);
  assert.equal(computeAttachmentBudget(2000, filled, filled), 0);
});

test('selectChunksWithinBudget keeps leading chunks and never exceeds the budget', () => {
  const chunks = [
    chunk('a', 'x'.repeat(40)),   // 10 tokens + 1
    chunk('b', 'y'.repeat(40)),   // 10 tokens + 1
    chunk('c', 'z'.repeat(40))    // 10 tokens + 1
  ];
  const selected = selectChunksWithinBudget(chunks, 25);
  assert.deepEqual(selected.map(c => c.id), ['a', 'b']); // 22 used, third would push past 25
});

test('assembleAttachmentContexts splits the budget evenly so one large file cannot starve its siblings', () => {
  const small = context('a.txt', [chunk('a1', 'A'.repeat(40))]);       // ~11 tokens
  const huge = context('b.txt', [chunk('b1', 'B'.repeat(4000))]);      // ~1001 tokens
  const output = assembleAttachmentContexts([small, huge], 100);       // 50 tokens each

  assert.match(output, /\[Attachment: a\.txt\]/);
  assert.doesNotMatch(output, /\[Attachment: b\.txt\]/);
});

test('assembleAttachmentContexts returns empty for no attachments or no budget', () => {
  assert.equal(assembleAttachmentContexts([], 100), '');
  assert.equal(assembleAttachmentContexts([context('a.txt', [chunk('a', 'x')])], 0), '');
});
