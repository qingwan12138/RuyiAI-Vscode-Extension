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

async function collectEvents(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

test('discovers and normalizes model ids', async () => {
  const provider = new OpenAICompatibleProvider({
    id: 'local', baseUrl: 'http://127.0.0.1:8080/v1',
    fetchImpl: async () => Response.json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })
  });
  assert.deepEqual(await provider.listModels(), ['a', 'b']);
});

test('reports explicitly configured tool-calling capability', async () => {
  const enabled = new OpenAICompatibleProvider({
    id: 'enabled', baseUrl: 'https://example.com/v1', toolCalling: true,
    fetchImpl: async () => { throw new Error('not used'); }
  });
  const disabled = new OpenAICompatibleProvider({
    id: 'disabled', baseUrl: 'https://example.com/v1',
    fetchImpl: async () => { throw new Error('not used'); }
  });

  assert.equal((await enabled.capabilities('model')).toolCalling, true);
  assert.equal((await disabled.capabilities('model')).toolCalling, false);
});

test('recognizes centralized DeepSeek vision model ids and exposes image transport', async () => {
  const provider = new OpenAICompatibleProvider({
    id: 'deepseek',
    providerKind: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    fetchImpl: async () => { throw new Error('not used'); }
  });

  assert.equal(provider.imageInputTransport, true);
  // The current DeepSeek vision model is plain `deepseek-flash`
  // (DeepSeek-V4.1-Flash) and carries no marker in its id; the retired
  // `deepseek-v4-flash*` aliases are served by the same model. Together with
  // imageInputTransport this is both halves of the attachment vision gate.
  assert.equal((await provider.capabilities('deepseek-flash')).vision, true);
  assert.equal((await provider.capabilities('deepseek-v4-flash-vision-exp')).vision, true);
  assert.equal((await provider.capabilities('deepseek-v4-flash')).vision, true);
  assert.equal((await provider.capabilities('deepseek-v4-pro')).vision, false);
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

test('serializes multimodal content as OpenAI-compatible image_url blocks', async () => {
  let sent;
  const provider = new OpenAICompatibleProvider({
    id: 'deepseek', providerKind: 'deepseek', baseUrl: 'https://api.deepseek.com',
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return sseResponse(['data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n']);
    }
  });
  await collect(provider.streamChat({
    model: 'deepseek-v4-flash-vision-exp',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Describe this image' },
      { type: 'image', mimeType: 'image/jpeg', dataBase64: 'AQID', fileName: 'photo.jpg' }
    ] }]
  }));

  assert.deepEqual(sent.messages[0], {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this image' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } }
    ]
  });
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

test('maps structural agent messages and reassembles fragmented tool calls', async () => {
  let sent;
  const provider = new OpenAICompatibleProvider({
    id: 'openai', baseUrl: 'https://api.openai.com/v1',
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"\\"src/main.ts\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n'
      ]);
    }
  });
  const request = {
    model: 'gpt-compatible',
    messages: [
      { role: 'user', content: 'inspect' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'old-1', name: 'search_text', input: { query: 'x' } }] },
      { role: 'tool', toolCallId: 'old-1', name: 'search_text', content: '{"matches":[]}' }
    ],
    tools: [{
      name: 'read_file', description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }]
  };

  const events = await collectEvents(provider.streamAgent(request));

  assert.deepEqual(events, [{ type: 'toolCall', call: { id: 'call-1', name: 'read_file', input: { path: 'src/main.ts' } } }]);
  assert.equal(sent.tool_choice, 'auto');
  assert.equal(sent.stream, true);
  assert.deepEqual(sent.tools, [{ type: 'function', function: request.tools[0] }]);
  assert.deepEqual(sent.messages[1], {
    role: 'assistant', content: null,
    tool_calls: [{ id: 'old-1', type: 'function', function: { name: 'search_text', arguments: '{"query":"x"}' } }]
  });
  assert.deepEqual(sent.messages[2], {
    role: 'tool', tool_call_id: 'old-1', name: 'search_text', content: '{"matches":[]}'
  });
});

test('preserves multimodal user content on the structural agent path', async () => {
  let sent;
  const provider = new OpenAICompatibleProvider({
    id: 'deepseek', providerKind: 'deepseek', baseUrl: 'https://api.deepseek.com', toolCalling: true,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return sseResponse([
        'data: {\"choices\":[{\"delta\":{\"content\":\"seen\"},\"finish_reason\":null}]}\n\n',
        'data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n',
        'data: [DONE]\n\n'
      ]);
    }
  });

  await collectEvents(provider.streamAgent({
    model: 'deepseek-v4-flash-vision-exp',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Inspect' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'AA==', fileName: 'x.png' }
    ] }],
    tools: []
  }));

  assert.equal(sent.messages[0].content[1].type, 'image_url');
  assert.equal(sent.messages[0].content[1].image_url.url, 'data:image/png;base64,AA==');
});

test('streams normalized final text agent events', async () => {
  const provider = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1',
    fetchImpl: async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ])
  });
  assert.deepEqual(await collectEvents(provider.streamAgent({ model: 'm', messages: [], tools: [] })), [
    { type: 'textDelta', text: 'answer' }
  ]);
});

test('rejects malformed, missing, and oversized tool call arguments', async () => {
  const cases = [
    '{bad',
    '[]',
    JSON.stringify({ value: 'x'.repeat(70_000) }),
    '{"path":"x"}'
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const args = cases[index];
    const provider = new OpenAICompatibleProvider({
      id: 'p', baseUrl: 'https://example.com/v1',
      fetchImpl: async () => sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...(index === 3 ? {} : { id: 'call-1' }), function: { name: 'read_file', arguments: args } }] }, finish_reason: null }] })}\n\n`,
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
      ])
    });
    await assert.rejects(
      async () => collectEvents(provider.streamAgent({ model: 'm', messages: [], tools: [] })),
      /Malformed provider tool call|too large/
    );
  }
});

test('emits multiple indexed calls and tolerates text+tool in one round, rejecting excessive calls', async () => {
  const calls = [
    { index: 0, id: 'c0', function: { name: 'read_file', arguments: '{"path":"a"}' } },
    { index: 1, id: 'c1', function: { name: 'list_directory', arguments: '{"path":"."}' } }
  ];
  const multiple = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1',
    fetchImpl: async () => sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls }, finish_reason: null }] })}\n\n`,
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
    ])
  });
  assert.deepEqual(
    (await collectEvents(multiple.streamAgent({ model: 'm', messages: [], tools: [] }))).map(event => event.call.id),
    ['c0', 'c1']
  );

  // A single assistant turn may legally carry text (a preamble) AND tool calls.
  const mixed = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1',
    fetchImpl: async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"text"},"finish_reason":null}]}\n\n',
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [calls[0]] }, finish_reason: null }] })}\n\n`,
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
    ])
  });
  const mixedEvents = await collectEvents(mixed.streamAgent({ model: 'm', messages: [], tools: [] }));
  assert.equal(mixedEvents[0].type, 'textDelta');
  assert.equal(mixedEvents[0].text, 'text');
  assert.equal(mixedEvents[1].type, 'toolCall');
  assert.equal(mixedEvents[1].call.id, 'c0');

  const excessiveCalls = Array.from({ length: 17 }, (_, index) => ({
    index, id: `c${index}`, function: { name: 'read_file', arguments: '{}' }
  }));
  const excessive = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1',
    fetchImpl: async () => sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: excessiveCalls }, finish_reason: null }] })}\n\n`
    ])
  });
  await assert.rejects(
    async () => collectEvents(excessive.streamAgent({ model: 'm', messages: [], tools: [] })),
    /too many tool calls/
  );
});

test('retries a network connect failure once with backoff, then succeeds', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1', retries: 1, retryBackoffMs: 5,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      ]);
    }
  });

  assert.equal(await collect(provider.streamChat({ model: 'm', messages: [] })), 'ok');
  assert.equal(calls, 2);
});

test('aborting during the retry backoff rejects as AbortError instead of hanging', async () => {
  const controller = new AbortController();
  const provider = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1', retries: 1, retryBackoffMs: 5_000,
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });
  const iterating = collectEvents(provider.streamAgent({ model: 'm', messages: [], tools: [] }, controller.signal));
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(iterating, error => error && error.name === 'AbortError');
});

test('a provider HTTP error status is not retried as a network failure', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1', retries: 1, retryBackoffMs: 5,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"error":"bad model"}', { status: 400 });
    }
  });
  await assert.rejects(
    async () => collect(provider.streamChat({ model: 'm', messages: [] })),
    error => error instanceof ProviderTransportError && error.status === 400
  );
  assert.equal(calls, 1);
});

test('a provider error body never echoes the API key', async () => {
  const key = 'sk-super-secret-abcdefghijklmnop';
  const provider = new OpenAICompatibleProvider({
    id: 'p', baseUrl: 'https://example.com/v1', apiKey: key, retries: 0,
    fetchImpl: async () => new Response('{"error":"invalid key ' + key + '"}', { status: 401 })
  });
  await assert.rejects(
    async () => collect(provider.streamChat({ model: 'm', messages: [] })),
    error => {
      assert.ok(error instanceof ProviderTransportError);
      assert.equal(error.message.includes(key), false, 'api key must not appear in the error');
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});
