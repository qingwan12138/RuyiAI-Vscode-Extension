const test = require('node:test');
const assert = require('node:assert/strict');

const { parseServerSentEvents } = require('../dist/yisi/infrastructure/llm/sseParser');

function stream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

test('parses SSE data across arbitrary byte and line boundaries', async () => {
  const values = await collect(parseServerSentEvents(stream([
    ': keepalive\r\n',
    'data: first\r',
    '\ndata: second\r\n\r',
    '\ndata: final\n\n'
  ])));
  assert.deepEqual(values, ['first\nsecond', 'final']);
});

test('flushes a final event without a trailing blank line', async () => {
  assert.deepEqual(await collect(parseServerSentEvents(stream(['data: tail']))), ['tail']);
});

test('aborts before reading an SSE stream', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async () => collect(parseServerSentEvents(stream(['data: ignored\n\n']), controller.signal)), error => error.name === 'AbortError');
});
