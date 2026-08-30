const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OpenAICompatibleProvider,
  ProviderTransportError
} = require('../dist/yisi/infrastructure/llm/openAICompatibleProvider');

function sseResponse(chunks, init = {}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  }), { status: 200, ...init });
}

async function collect(iterable) {
  let text = '';
  for await (const delta of iterable) text += delta.text;
  return text;
}

test('discovers and normalizes model ids', async () => {
  const provider = new OpenAICompatibleProvider({
    id: 'local', baseUrl: 'http://127.0.0.1:8080/v1',
    fetchImpl: async () => Response.json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })
  });
  assert.deepEqual(await provider.listModels(), ['a', 'b']);
});

test('streams text deltas and sends the compatible request shape', async () => {
  let request;
  const provider = new OpenAICompatibleProvider({
    id: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'top-secret',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'
      ]);
    }
  });
  const signal = new AbortController().signal;
  const output = await collect(provider.streamChat({ model: 'model-a', messages: [{ role: 'user', content: 'Hi' }] }, signal));

  assert.equal(output, 'Hello');
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer top-secret');
  assert.equal(request.init.signal, signal);
  assert.deepEqual(JSON.parse(request.init.body), { model: 'model-a', messages: [{ role: 'user', content: 'Hi' }], stream: true });
});

test('omits Authorization for credential-free local providers', async () => {
  let headers;
  const provider = new OpenAICompatibleProvider({
    id: 'local', baseUrl: 'http://127.0.0.1:8080/v1',
    fetchImpl: async (_url, init) => {
      headers = init.headers;
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']);
    }
  });
  await collect(provider.streamChat({ model: 'local', messages: [] }));
  assert.equal('Authorization' in headers, false);
});

test('normalizes non-success responses without exposing large bodies', async () => {
  const provider = new OpenAICompatibleProvider({
    id: 'remote', baseUrl: 'https://example.com/v1', apiKey: 'secret',
    fetchImpl: async () => new Response('x'.repeat(5000), { status: 401, headers: { 'x-request-id': 'req-safe' } })
  });
  await assert.rejects(
    async () => collect(provider.streamChat({ model: 'm', messages: [] })),
    error => error instanceof ProviderTransportError && error.status === 401 && error.requestId === 'req-safe' && error.message.length < 500
  );
});

test('rejects malformed streamed JSON and empty responses', async () => {
  const malformed = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'https://example.com/v1', fetchImpl: async () => sseResponse(['data: {bad}\n\n']) });
  await assert.rejects(async () => collect(malformed.streamChat({ model: 'm', messages: [] })), /Malformed provider stream event/);
  const empty = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'https://example.com/v1', fetchImpl: async () => sseResponse(['data: [DONE]\n\n']) });
  await assert.rejects(async () => collect(empty.streamChat({ model: 'm', messages: [] })), /empty response/);
});
