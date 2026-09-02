const test = require('node:test');
const assert = require('node:assert/strict');

const { AnthropicProvider } = require('../dist/yisi/infrastructure/llm/anthropicProvider');

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  }), { status: 200 });
}

async function collect(iterable) {
  let text = '';
  for await (const delta of iterable) text += delta.text;
  return text;
}

test('advertises image transport and recognizes modern Claude vision models', async () => {
  const provider = new AnthropicProvider({
    id: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-5'],
    fetchImpl: async () => { throw new Error('not used'); }
  });
  assert.equal(provider.imageInputTransport, true);
  assert.equal((await provider.capabilities('claude-sonnet-4-5')).vision, true);
});

test('serializes multimodal user content as Anthropic base64 image blocks', async () => {
  let sent;
  const provider = new AnthropicProvider({
    id: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-5'],
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
      ]);
    }
  });

  const output = await collect(provider.streamChat({
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Describe' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'AA==', fileName: 'x.png' }
    ] }]
  }));

  assert.equal(output, 'ok');
  assert.deepEqual(sent.messages[0], {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }
    ]
  });
});
