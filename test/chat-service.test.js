const test = require('node:test');
const assert = require('node:assert/strict');

const { ChatService, ChatRunInProgressError } = require('../dist/yisi/application/chat/chatService');
const { SessionService } = require('../dist/yisi/application/session/sessionService');

class MemoryRepository {
  async load() { return this.document && structuredClone(this.document); }
  async save(document) { this.document = structuredClone(document); }
}

async function harness(provider, agentRunner, rehydrator) {
  const repository = new MemoryRepository();
  let id = 0;
  const sessions = new SessionService(repository, { now: () => ++id, createId: () => `id-${++id}` });
  await sessions.initialize('workspace', []);
  await sessions.setModelSelection({ providerId: 'provider', modelId: 'model' });
  const chat = new ChatService(sessions, { resolve: async () => provider }, agentRunner, undefined, rehydrator);
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

test('sends explicitly attached file content once but persists only its reference', async () => {
  const capture = {};
  const { chat, sessions } = await harness(streamingProvider(['done'], capture));
  const context = {
    reference: { type: 'file', path: 'src/main.ts', workspaceFolderUri: 'file:///workspace' },
    attachment: {
      id: 'att-1',
      fileName: 'main.ts',
      kind: 'code',
      chunks: [{ id: 'chunk-1', text: 'export const answer = 42;', startLine: 1, endLine: 1 }],
      truncated: false,
      warnings: []
    }
  };

  await chat.send('Explain this file', () => {}, new AbortController().signal, [context]);

  const sent = capture.request.messages.at(-1).content;
  assert.match(sent, /Attached context:/);
  assert.match(sent, /\[Attachment: main\.ts\]/);
  assert.match(sent, /export const answer = 42/);
  const user = sessions.getActiveSession().items.find(item => item.type === 'userMessage');
  assert.deepEqual(user.contexts, [context.reference]);
  assert.equal(JSON.stringify(sessions.getActiveSession()).includes('export const answer = 42'), false);
});

test('passes image attachments as multimodal content without persisting base64 in the session', async () => {
  const capture = {};
  const provider = streamingProvider(['done'], capture);
  provider.capabilities = async () => ({ toolCalling: false, streaming: true, vision: true });
  const { chat, sessions } = await harness(provider);
  const context = {
    reference: { type: 'file', path: 'photo.jpg', workspaceFolderUri: 'file:///workspace' },
    attachment: {
      id: 'img-1',
      fileName: 'photo.jpg',
      kind: 'image',
      chunks: [],
      image: { mimeType: 'image/jpeg', dataBase64: 'AQID' },
      truncated: false,
      warnings: []
    }
  };

  await chat.send('What is in this image?', () => {}, new AbortController().signal, [context]);

  const content = capture.request.messages.at(-1).content;
  assert.equal(Array.isArray(content), true);
  assert.equal(content.some(part => part.type === 'image' && part.dataBase64 === 'AQID'), true);
  assert.equal(JSON.stringify(sessions.getActiveSession()).includes('AQID'), false);
  const user = sessions.getActiveSession().items.find(item => item.type === 'userMessage');
  assert.deepEqual(user.contexts, [context.reference]);
});

test('rehydrates a prior attachment reference into a later turn', async () => {
  const capture = {};
  const rehydrator = {
    async rehydrate(reference) {
      assert.deepEqual(reference, { type: 'file', path: 'src/main.ts', workspaceFolderUri: 'file:///workspace' });
      return {
        id: 'att-1',
        fileName: 'main.ts',
        kind: 'code',
        chunks: [{ id: 'chunk-1', text: 'export const rehydrated = true;', startLine: 1, endLine: 1 }],
        truncated: false,
        warnings: []
      };
    }
  };
  const { chat } = await harness(streamingProvider(['done'], capture), undefined, rehydrator);
  const context = {
    reference: { type: 'file', path: 'src/main.ts', workspaceFolderUri: 'file:///workspace' },
    attachment: {
      id: 'att-1',
      fileName: 'main.ts',
      kind: 'code',
      chunks: [{ id: 'chunk-1', text: 'export const answer = 42;', startLine: 1, endLine: 1 }],
      truncated: false,
      warnings: []
    }
  };

  await chat.send('First', () => {}, new AbortController().signal, [context]);
  await chat.send('Second', () => {}, new AbortController().signal);

  const firstUser = capture.request.messages.find(message => message.content.includes('First'));
  assert.match(firstUser.content, /\[Attachment: main\.ts\]/);
  assert.match(firstUser.content, /export const rehydrated = true/);
  assert.equal(JSON.stringify(capture.request.messages).includes('export const answer = 42'), false);
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

test('routes an explicitly capable provider through the agent runner and persists only final text', async () => {
  const captured = {};
  const provider = streamingProvider([]);
  provider.capabilities = async () => ({ toolCalling: true, streaming: true });
  provider.streamChat = async function* () { throw new Error('text chat must not run'); };
  const agentRunner = {
    async run(receivedProvider, request, session, onDelta, signal) {
      Object.assign(captured, { receivedProvider, request, session, signal });
      onDelta('Agent ');
      onDelta('answer');
      return 'Agent answer';
    }
  };
  const { chat, sessions } = await harness(provider, agentRunner);
  const deltas = [];
  const signal = new AbortController().signal;

  await chat.send('Inspect', delta => deltas.push(delta), signal);

  assert.equal(captured.receivedProvider, provider);
  assert.equal(captured.request.model, 'model');
  assert.deepEqual(captured.request.messages, [{ role: 'user', content: 'Inspect' }]);
  assert.equal(captured.session.sessionId, sessions.getActiveSession().id);
  assert.equal(captured.session.mode, 'plan');
  assert.equal(captured.signal, signal);
  assert.deepEqual(deltas, ['Agent ', 'answer']);
  assert.equal(sessions.getActiveSession().items.at(-1).text, 'Agent answer');
  assert.equal(sessions.getActiveSession().items.at(-1).source, 'provider');
});

test('fails closed when tool calling is enabled but the agent runner is unavailable', async () => {
  const provider = streamingProvider(['must not stream']);
  provider.capabilities = async () => ({ toolCalling: true, streaming: true });
  const { chat, sessions } = await harness(provider);

  await assert.rejects(
    chat.send('Inspect', () => {}, new AbortController().signal),
    /Agent tools are unavailable/
  );

  assert.equal(sessions.getActiveSession().items.at(-1).type, 'userMessage');
  assert.equal(sessions.getActiveSession().status, 'blocked');
});

test('agent runner cancellation preserves the existing interrupted status behavior', async () => {
  const provider = streamingProvider([]);
  provider.capabilities = async () => ({ toolCalling: true, streaming: true });
  const controller = new AbortController();
  const agentRunner = {
    async run() {
      controller.abort();
      controller.signal.throwIfAborted();
    }
  };
  const { chat, sessions } = await harness(provider, agentRunner);

  await assert.rejects(
    chat.send('Cancel agent', () => {}, controller.signal),
    error => error && error.name === 'AbortError'
  );
  assert.equal(sessions.getActiveSession().status, 'interrupted');
});

test('uses a session-scoped runner for write sessions and falls back to the shared runner for plan', async () => {
  const repository = new MemoryRepository();
  let id = 0;
  const sessions = new SessionService(repository, { now: () => ++id, createId: () => `id-${++id}` });
  await sessions.initialize('workspace', []);
  await sessions.setModelSelection({ providerId: 'provider', modelId: 'model' });
  await sessions.setPermissionMode('manual');

  const toolProvider = {
    id: 'provider',
    async capabilities() { return { streaming: true, toolCalling: true }; },
    async *streamAgent() { yield { type: 'textDelta', text: 'x' }; }
  };
  const shared = { async run(_p, _r, _s, onDelta) { onDelta('shared answer'); return 'shared answer'; } };
  const scoped = { async run(_p, _r, _s, onDelta) { onDelta('scoped answer'); return 'scoped answer'; } };
  let scopedCalls = 0;
  const chat = new ChatService(
    sessions,
    { resolve: async () => toolProvider },
    shared,
    undefined,
    undefined,
    async session => {
      if (session.mode === 'plan') return undefined;
      scopedCalls += 1;
      return scoped;
    }
  );

  const deltas = [];
  await chat.send('Write in a session', delta => deltas.push(delta), new AbortController().signal);
  assert.equal(deltas.join(''), 'scoped answer');
  assert.equal(scopedCalls, 1);

  // A plan session must not be isolated: it falls back to the shared runner.
  await sessions.setPermissionMode('plan');
  const planDeltas = [];
  await chat.send('Read only', delta => planDeltas.push(delta), new AbortController().signal);
  assert.equal(planDeltas.join(''), 'shared answer');
  assert.equal(scopedCalls, 1);
});
