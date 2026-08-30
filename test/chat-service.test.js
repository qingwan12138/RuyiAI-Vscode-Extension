const test = require('node:test');
const assert = require('node:assert/strict');

const { ChatService, ChatRunInProgressError } = require('../dist/yisi/application/chat/chatService');
const { SessionService } = require('../dist/yisi/application/session/sessionService');

class MemoryRepository {
  async load() { return this.document && structuredClone(this.document); }
  async save(document) { this.document = structuredClone(document); }
}

async function harness(provider) {
  const repository = new MemoryRepository();
  let id = 0;
  const sessions = new SessionService(repository, { now: () => ++id, createId: () => `id-${++id}` });
  await sessions.initialize('workspace', []);
  await sessions.setModelSelection({ providerId: 'provider', modelId: 'model' });
  const chat = new ChatService(sessions, { resolve: async () => provider });
  return { chat, sessions };
}

function streamingProvider(chunks, capture) {
  return {
    id: 'provider',
    async listModels() { return ['model']; },
    async capabilities() { return { streaming: true }; },
    async *streamChat(request) {
      if (capture) capture.request = request;
      for (const text of chunks) yield { text };
    }
  };
}

test('streams deltas, excludes baseline notices, and persists completed provider output', async () => {
  const capture = {};
  const { chat, sessions } = await harness(streamingProvider(['Hel', 'lo'], capture));
  await sessions.appendAssistantMessage('Do not send this baseline notice', 'baseline');
  const deltas = [];

  await chat.send('Question', delta => deltas.push(delta), new AbortController().signal);

  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.equal(capture.request.messages.some(message => message.content.includes('baseline')), false);
  const items = sessions.getActiveSession().items;
  assert.equal(items.at(-1).text, 'Hello');
  assert.equal(items.at(-1).source, 'provider');
  assert.equal(sessions.getActiveSession().status, 'idle');
});

test('keeps the user message but no completed assistant response on provider failure', async () => {
  const provider = streamingProvider([]);
  provider.streamChat = async function* () { throw new Error('network failed'); };
  const { chat, sessions } = await harness(provider);

  await assert.rejects(() => chat.send('Durable question', () => {}, new AbortController().signal), /network failed/);

  const items = sessions.getActiveSession().items;
  assert.equal(items.at(-1).type, 'userMessage');
  assert.equal(items.at(-1).text, 'Durable question');
  assert.equal(sessions.getActiveSession().status, 'blocked');
});

test('rejects a concurrent send while a run is active', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const provider = streamingProvider([]);
  provider.streamChat = async function* () { await gate; yield { text: 'done' }; };
  const { chat } = await harness(provider);
  const first = chat.send('first', () => {}, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));

  await assert.rejects(() => chat.send('second', () => {}, new AbortController().signal), ChatRunInProgressError);
  release();
  await first;
});

test('marks an aborted run interrupted and rethrows cancellation', async () => {
  const provider = streamingProvider([]);
  provider.streamChat = async function* (_request, signal) { signal.throwIfAborted(); yield { text: 'never' }; };
  const { chat, sessions } = await harness(provider);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => chat.send('cancel me', () => {}, controller.signal), error => error.name === 'AbortError');
  assert.equal(sessions.getActiveSession().status, 'interrupted');
});
