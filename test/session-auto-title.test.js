// The ChatService half of session auto-titling: after the first exchange the
// session is renamed from the model's reply. The pure prompt/parse logic is
// covered by session-title.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { SessionService } = require('../dist/yisi/application/session/sessionService');
const { ChatService } = require('../dist/yisi/application/chat/chatService');

class MemoryRepository {
  constructor(document) {
    this.document = document;
  }

  async load() {
    return this.document === undefined ? undefined : structuredClone(this.document);
  }

  async save(document) {
    this.document = structuredClone(document);
  }
}

/** Every streamChat call is recorded, because the title request is one too. */
function createProvider(replies, failOn = -1) {
  return {
    id: 'p',
    calls: [],
    async capabilities() {
      return { toolCalling: false, streaming: true, vision: false, reasoning: false, structuredOutput: false };
    },
    async *streamChat(request) {
      const index = this.calls.length;
      this.calls.push(request);
      if (index === failOn) throw new Error('title provider exploded');
      yield { text: replies[index] ?? replies[replies.length - 1] ?? '' };
    }
  };
}

function createHarness({ replies = ['这是模型的回答', '修复构建错误'], autoTitle, failOn = -1 } = {}) {
  const repository = new MemoryRepository();
  let timestamp = 0;
  const sessions = new SessionService(repository, {
    now: () => ++timestamp,
    createId: () => `id-${timestamp}`
  });
  const provider = createProvider(replies, failOn);
  const chat = new ChatService(
    sessions,
    { resolve: async () => provider },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    autoTitle === undefined ? {} : { autoTitle: () => autoTitle }
  );
  return { chat, sessions, provider };
}

async function seed(sessions) {
  await sessions.initialize('workspace-a', []);
  await sessions.setModelSelection({ providerId: 'p', modelId: 'm' });
}

function send(chat, text) {
  return chat.send(text, () => undefined, new AbortController().signal);
}

test('a session is named from its first exchange by a bare extra request', async () => {
  const { chat, sessions, provider } = createHarness({ autoTitle: { enabled: true } });
  await seed(sessions);

  await send(chat, '帮我修复这个构建错误');

  assert.equal(sessions.getActiveSession().title, '修复构建错误');
  assert.equal(sessions.getActiveSession().titleSource, 'ai');

  assert.equal(provider.calls.length, 2, 'one request for the reply, one for the title');
  const [replyCall, titleCall] = provider.calls;
  assert.equal(replyCall.messages.length, 1, 'the reply itself replays just the new message');
  // The title request is bare: a system instruction plus the first exchange, and
  // the reply is not streamed into the conversation.
  assert.equal(titleCall.messages.length, 2);
  assert.equal(titleCall.messages[0].role, 'system');
  assert.equal(titleCall.messages[1].role, 'user');
  assert.match(titleCall.messages[1].content, /帮我修复这个构建错误/);
  assert.match(titleCall.messages[1].content, /这是模型的回答/);
  assert.equal(titleCall.tools, undefined, 'no agent tools on a titling request');
  assert.equal(titleCall.temperature, 0);
  assert.ok(titleCall.maxTokens > 0 && titleCall.maxTokens <= 64, 'titles stay cheap');
});

test('the session is not renamed a second time', async () => {
  const { chat, sessions, provider } = createHarness({ autoTitle: { enabled: true } });
  await seed(sessions);

  await send(chat, '帮我修复这个构建错误');
  const callsAfterFirst = provider.calls.length;
  await send(chat, '再帮我加个测试');

  assert.equal(provider.calls.length, callsAfterFirst + 1, 'the second turn issues no titling request');
  assert.equal(sessions.getActiveSession().title, '修复构建错误');
});

test('nothing is requested when the setting is off', async () => {
  const { chat, sessions, provider } = createHarness({ autoTitle: { enabled: false } });
  await seed(sessions);

  await send(chat, '帮我修复这个构建错误');

  assert.equal(provider.calls.length, 1, 'no titling request when disabled');
  assert.equal(sessions.getActiveSession().title, 'New Chat');
  assert.equal(sessions.getActiveSession().titleSource, 'fallback');
});

test('nothing is requested when no policy is wired at all', async () => {
  // The composition root opts in; an absent policy must stay inert so existing
  // callers keep their behaviour.
  const { chat, sessions, provider } = createHarness();
  await seed(sessions);

  await send(chat, '帮我修复这个构建错误');

  assert.equal(provider.calls.length, 1);
  assert.equal(sessions.getActiveSession().title, 'New Chat');
});

test("a title the user set is never overwritten", async () => {
  const { chat, sessions, provider } = createHarness({ autoTitle: { enabled: true } });
  await seed(sessions);
  const sessionId = sessions.getActiveSession().id;
  await sessions.renameSession(sessionId, '我自己的名字');

  await send(chat, '帮我修复这个构建错误');

  assert.equal(provider.calls.length, 1, 'a manually named session is not titling material');
  assert.equal(sessions.getActiveSession().title, '我自己的名字');
  assert.equal(sessions.getActiveSession().titleSource, 'manual');
});

test('a failed titling request leaves the placeholder and never fails the run', async () => {
  const { chat, sessions } = createHarness({ autoTitle: { enabled: true }, failOn: 1 });
  await seed(sessions);

  await send(chat, '帮我修复这个构建错误');

  const session = sessions.getActiveSession();
  assert.equal(session.title, 'New Chat');
  assert.equal(session.titleSource, 'fallback');
  assert.equal(session.status, 'idle', 'the run itself still completed');
  assert.equal(session.items.length, 2, 'the reply was persisted');
});

test('an unusable titling reply leaves the placeholder title', async () => {
  const { chat, sessions } = createHarness({
    autoTitle: { enabled: true },
    replies: ['这是模型的回答', '   \n  ']
  });
  await seed(sessions);

  await send(chat, '帮我修复这个构建错误');

  assert.equal(sessions.getActiveSession().title, 'New Chat');
  assert.equal(sessions.getActiveSession().titleSource, 'fallback');
});
