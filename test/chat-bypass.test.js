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

function createProvider() {
  return {
    id: 'p',
    async capabilities() {
      return { toolCalling: true, streaming: true, vision: false, reasoning: false, structuredOutput: false };
    },
    async *streamChat(request) {
      this.lastChat = request;
      yield { text: '我是 DeepSeek 的 deepseek-v4-flash。' };
    },
    lastChat: undefined
  };
}

function createHarness(options = {}) {
  const repository = new MemoryRepository();
  let timestamp = 0;
  const sessions = new SessionService(repository, {
    now: () => ++timestamp,
    createId: () => `id-${timestamp}`
  });
  const provider = createProvider();
  const agentCalls = [];
  const agentRunner = {
    async run(_provider, request) {
      agentCalls.push(request);
      return 'AGENT_RUN_OUTPUT';
    }
  };
  const chat = new ChatService(
    sessions,
    { resolve: async () => provider },
    agentRunner,
    options.policy === undefined ? undefined : () => options.policy
  );
  return { chat, sessions, provider, agentCalls };
}

async function seedSelection(sessions) {
  await sessions.initialize('workspace-a', []);
  await sessions.setModelSelection({ providerId: 'p', modelId: 'm' });
}

function collect(chat, text) {
  const deltas = [];
  return chat.send(text, delta => deltas.push(delta), new AbortController().signal).then(() => deltas.join(''));
}

test('answers an identity question through bare chat with no tools and no history', async () => {
  const { chat, sessions, provider, agentCalls } = createHarness();
  await seedSelection(sessions);

  const reply = await collect(chat, '你是什么模型');

  assert.equal(reply, '我是 DeepSeek 的 deepseek-v4-flash。');
  assert.equal(agentCalls.length, 0, 'agent tool loop must not run');
  assert.equal(provider.lastChat.messages.length, 1, 'no history must be replayed');
  assert.equal(provider.lastChat.messages[0].content, '你是什么模型');
  assert.equal(provider.lastChat.tools, undefined, 'no tools must be attached');
  assert.deepEqual(
    sessions.getActiveSession().items.map(item => [item.type, item.text]),
    [
      ['userMessage', '你是什么模型'],
      ['assistantMessage', '我是 DeepSeek 的 deepseek-v4-flash。']
    ]
  );
});

test('identity bypass still ignores earlier conversation history', async () => {
  const { chat, sessions, provider } = createHarness();
  await seedSelection(sessions);
  await sessions.appendUserMessage('旧的编码问题');
  await sessions.appendAssistantMessage('旧的回答', 'provider');

  await collect(chat, '你是谁');

  assert.equal(provider.lastChat.messages.length, 1);
  assert.equal(provider.lastChat.messages[0].content, '你是谁');
});

test('normal coding messages keep the full agent tool path', async () => {
  const { chat, sessions, provider, agentCalls } = createHarness();
  await seedSelection(sessions);

  await collect(chat, '帮我重构这个函数，去掉重复代码');

  assert.equal(agentCalls.length, 1);
  assert.equal(provider.lastChat, undefined, 'streamChat must not be used for coding messages');
  const sent = agentCalls[0];
  assert.deepEqual(sent.messages.map(item => item.content), ['帮我重构这个函数，去掉重复代码']);
});

test('coding request that mentions the assistant still goes through the agent path', async () => {
  const { chat, sessions, agentCalls } = createHarness();
  await seedSelection(sessions);

  await collect(chat, '你是什么模型？帮我实现一个排序算法');

  assert.equal(agentCalls.length, 1, 'task-carrying identity mention must stay on the agent path');
});

test('disabling the policy restores the previous behaviour for identity questions', async () => {
  const { chat, sessions, provider, agentCalls } = createHarness({ policy: { enabled: false } });
  await seedSelection(sessions);

  await collect(chat, '你是什么模型');

  assert.equal(agentCalls.length, 1, 'disabled policy must keep the agent tool path');
  assert.equal(provider.lastChat, undefined);
});
