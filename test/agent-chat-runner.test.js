const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AgentCapabilityError,
  AgentChatRunner,
  AgentLoopBlockedError
} = require('../dist/yisi/application/agent/agentChatRunner');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

function registry() {
  return new ToolRegistry([{
    id: 'read_file', description: 'Read', risk: 'readOnly', mutatesWorkspace: false,
    supportsCancellation: true, inputSchema: { type: 'object' },
    execute: async () => ({ text: 'content' })
  }]);
}

function runner() {
  return new AgentChatRunner(registry(), new PermissionEngine(), 'file:///workspace');
}

test('runs a capable provider with session identity and returns final text', async () => {
  const requests = [];
  const provider = {
    async *streamAgent(request, signal) {
      requests.push({ request, signal });
      yield { type: 'textDelta', text: 'agent answer' };
    }
  };
  const signal = new AbortController().signal;
  const deltas = [];

  const answer = await runner().run(
    provider,
    { model: 'm', messages: [{ role: 'user', content: 'question' }] },
    { sessionId: 's1', mode: 'manual' },
    delta => deltas.push(delta),
    signal
  );

  assert.equal(answer, 'agent answer');
  assert.deepEqual(deltas, ['agent answer']);
  assert.equal(requests[0].signal, signal);
});

test('rejects providers without structural tool streaming', async () => {
  await assert.rejects(
    runner().run({}, { model: 'm', messages: [] }, { sessionId: 's1', mode: 'plan' }, () => {}, new AbortController().signal),
    AgentCapabilityError
  );
});

test('turns loop guards into a bounded blocked error', async () => {
  const provider = { async *streamAgent() {} };
  await assert.rejects(
    runner().run(provider, { model: 'm', messages: [] }, { sessionId: 's1', mode: 'plan' }, () => {}, new AbortController().signal),
    error => error instanceof AgentLoopBlockedError && /empty/i.test(error.message)
  );
});

test('forwards AbortSignal cancellation', async () => {
  const controller = new AbortController();
  const provider = {
    async *streamAgent(_request, signal) {
      controller.abort();
      signal.throwIfAborted();
    }
  };
  await assert.rejects(
    runner().run(provider, { model: 'm', messages: [] }, { sessionId: 's1', mode: 'plan' }, () => {}, controller.signal),
    error => error && error.name === 'AbortError'
  );
});
