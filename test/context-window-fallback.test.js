// Compaction must not depend on the provider declaring a context window.
//
// The gap this closes (docs/12 v0.7): the long-session guard only ran when
// `capabilities.maxContextTokens` was set, while the context ring in the UI fell
// back to the known-family estimate. So a model whose provider declares nothing
// could show "80% of the window used" and still never compact — and then fail on
// overflow, exactly where the DoD promised it would not.

const test = require('node:test');
const assert = require('node:assert/strict');

const { ChatService } = require('../dist/yisi/application/chat/chatService');
const { SessionService } = require('../dist/yisi/application/session/sessionService');

class MemoryRepository {
  async load() { return this.document && structuredClone(this.document); }
  async save(document) { this.document = structuredClone(document); }
}

/** A provider that declares no context window unless told to. */
function provider(capture, maxContextTokens) {
  return {
    id: 'provider',
    async listModels() { return ['model']; },
    async capabilities() {
      return maxContextTokens === undefined ? { streaming: true } : { streaming: true, maxContextTokens };
    },
    async *streamChat(request) {
      capture.request = request;
      yield { text: 'ok' };
    }
  };
}

/**
 * A session with a long history so the history budget is exceeded: every turn is
 * ~400 characters, which is far past a 1000-token window at ratio 0.6.
 */
async function longSession() {
  const sessions = new SessionService(new MemoryRepository(), { now: () => 1, createId: () => `id-${Math.random()}` });
  await sessions.initialize('workspace', []);
  await sessions.setModelSelection({ providerId: 'provider', modelId: 'model' });
  for (let index = 0; index < 12; index += 1) {
    await sessions.appendUserMessage(`question ${index} ${'q'.repeat(400)}`);
    await sessions.appendAssistantMessage(`answer ${index} ${'a'.repeat(400)}`, 'provider');
  }
  return sessions;
}

async function send(options, maxContextTokens, capture) {
  const sessions = await longSession();
  const chat = new ChatService(
    sessions,
    { resolve: async () => provider(capture, maxContextTokens) },
    undefined, undefined, undefined, undefined, 0.6, options
  );
  await chat.send('the current question', () => undefined, new AbortController().signal);
  return capture.request.messages;
}

test('a declared window still drives compaction', async () => {
  const capture = {};
  const messages = await send({}, 6_000, capture);
  assert.ok(
    messages.some(message => message.role === 'system' && /Earlier conversation omitted/.test(message.content)),
    'a declared window compacts as before'
  );
});

test('a known-family fallback compacts when the provider declares nothing', async () => {
  const capture = {};
  const messages = await send({ contextWindow: () => 6_000 }, undefined, capture);
  assert.ok(
    messages.some(message => message.role === 'system' && /Earlier conversation omitted/.test(message.content)),
    'the same estimate the ring shows must also trigger compaction'
  );
  // The current turn survives, as always.
  assert.equal(messages.at(-1).content, 'the current question');
});

test('the declaration wins over the fallback', async () => {
  const capture = {};
  // A huge declared window with a tiny fallback: nothing should be dropped.
  const messages = await send({ contextWindow: () => 6_000 }, 10_000_000, capture);
  assert.equal(
    messages.some(message => message.role === 'system' && /Earlier conversation omitted/.test(message.content)),
    false
  );
});

test('an unknown model still means "do not compact"', async () => {
  const capture = {};
  const messages = await send({ contextWindow: () => undefined }, undefined, capture);
  assert.equal(
    messages.some(message => message.role === 'system' && /Earlier conversation omitted/.test(message.content)),
    false,
    'no estimate, no compaction — the previous behaviour is unchanged'
  );
  assert.equal(messages.at(-1).content, 'the current question');
});

test('a throwing window resolver does not cost the message', async () => {
  const capture = {};
  const messages = await send({
    contextWindow: () => {
      throw new Error('settings unavailable');
    }
  }, undefined, capture);
  assert.equal(messages.at(-1).content, 'the current question');
});

test('the composition root shares one window source with the context ring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /contextWindow: \(providerId, modelId\) =>/);
  assert.match(source, /modelContextWindow\(\s*config\?\.kind \?\? 'openaiCompatible',\s*modelId,/);
  // The ring must compute its window the same way.
  assert.match(source, /const windowTokens = capabilities\.maxContextTokens\s*\n?\s*\?\? modelContextWindow\(/);
});
