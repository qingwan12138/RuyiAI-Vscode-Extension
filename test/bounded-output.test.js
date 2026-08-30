const test = require('node:test');
const assert = require('node:assert/strict');

const { BoundedOutput } = require('../dist/yisi/infrastructure/process/boundedOutput');

test('preserves UTF-8 split across arbitrary chunks below the limit', () => {
  const output = new BoundedOutput(32);
  const bytes = Buffer.from('A你B', 'utf8');
  output.append(bytes.subarray(0, 2));
  output.append(bytes.subarray(2, 4));
  output.append(bytes.subarray(4));

  assert.deepEqual(output.snapshot(), {
    text: 'A你B',
    totalBytes: 5,
    retainedBytes: 5,
    truncated: false
  });
});

test('retains the head and latest tail when output exceeds its byte limit', () => {
  const output = new BoundedOutput(10);
  output.append('abcdef');
  output.append('ghij');
  output.append('klmno');

  assert.deepEqual(output.snapshot(), {
    text: 'abcde\n… output truncated …\nklmno',
    totalBytes: 15,
    retainedBytes: 10,
    truncated: true
  });
});

test('updates the retained tail across many chunks without exceeding the limit', () => {
  const output = new BoundedOutput(8);
  for (const chunk of ['12', '34', '56', '78', '90', 'ab']) output.append(Buffer.from(chunk));

  const snapshot = output.snapshot();
  assert.equal(snapshot.text, '1234\n… output truncated …\n90ab');
  assert.equal(snapshot.totalBytes, 12);
  assert.equal(snapshot.retainedBytes, 8);
  assert.equal(snapshot.truncated, true);
});

test('rejects invalid output limits', () => {
  for (const limit of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => new BoundedOutput(limit), /positive integer/);
  }
});
