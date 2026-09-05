const test = require('node:test');
const assert = require('node:assert/strict');

const { ChatRunCoordinator } = require('../dist/yisi/ui/chatRunCoordinator');

test('forwards lifecycle events and streamed deltas in order', async () => {
  const events = [];
  const chat = {
    async send(text, onDelta, signal) {
      assert.equal(text, 'hello');
      assert.equal(signal.aborted, false);
      onDelta('Hel');
      onDelta('lo');
    }
  };
  const coordinator = new ChatRunCoordinator(chat, event => events.push(event));

  const outcome = await coordinator.start('hello');

  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' },
    { type: 'assistantStreamDelta', text: 'Hel' },
    { type: 'assistantStreamDelta', text: 'lo' },
    { type: 'assistantStreamCompleted' }
  ]);
  assert.deepEqual(outcome, { status: 'completed' });
  assert.equal(coordinator.isRunning(), false);
});

test('stop aborts the active provider run and emits runStopped', async () => {
  const events = [];
  const chat = {
    async send(_text, _onDelta, signal) {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  };
  const coordinator = new ChatRunCoordinator(chat, event => events.push(event));
  const running = coordinator.start('hello');

  assert.equal(coordinator.stop(), true);
  const outcome = await running;

  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' },
    { type: 'runStopped' }
  ]);
  assert.deepEqual(outcome, { status: 'stopped' });
  assert.equal(coordinator.stop(), false);
});

test('returns a normalized error outcome instead of emitting sessionError (caller surfaces it after state publish)', async () => {
  const events = [];
  const coordinator = new ChatRunCoordinator(
    { async send() { throw new Error('provider unavailable'); } },
    event => events.push(event)
  );

  const outcome = await coordinator.start('hello');

  // Live events stop at the run start; the error is delivered through the
  // returned outcome so the caller can publish state BEFORE posting it (the
  // webview state re-render would otherwise wipe the message instantly).
  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' }
  ]);
  assert.deepEqual(outcome, { status: 'error', message: 'provider unavailable' });
});

test('guards overlapping runs through the outcome instead of an event', async () => {
  const events = [];
  let resolveSend;
  const chat = {
    async send() { await new Promise(resolve => { resolveSend = resolve; }); }
  };
  const coordinator = new ChatRunCoordinator(chat, event => events.push(event));
  const running = coordinator.start('first');

  const guarded = await coordinator.start('second');
  assert.deepEqual(guarded, { status: 'error', message: 'A chat run is already in progress.' });
  assert.deepEqual(events, [{ type: 'assistantStreamStarted' }]);

  resolveSend();
  await running;
});

test('forwards only host-resolved explicit contexts to ChatService', async () => {
  let received;
  const context = {
    reference: { type: 'file', path: 'src/main.ts', workspaceFolderUri: 'file:///workspace' },
    content: 'const value = 1;'
  };
  const coordinator = new ChatRunCoordinator({
    async send(_text, _onDelta, _signal, contexts) { received = contexts; }
  }, () => {});

  const outcome = await coordinator.start('explain', [context]);

  assert.deepEqual(received, [context]);
  assert.deepEqual(outcome, { status: 'completed' });
});

test('forwards agent tool lifecycle events to the webview', async () => {
  const events = [];
  const chat = {
    async send(_text, _onDelta, _signal, _contexts, onToolEvent) {
      if (onToolEvent) {
        onToolEvent({ type: 'toolCall', id: 'c1', name: 'read_file', input: { path: 'src/a.ts' } });
        onToolEvent({ type: 'toolResult', id: 'c1', name: 'read_file', outcome: 'succeeded', truncated: false, summary: '{"ok":true,"result":{"text":"export const value = 1;"}}' });
      }
    }
  };
  const coordinator = new ChatRunCoordinator(chat, event => events.push(event));

  const outcome = await coordinator.start('inspect');

  assert.deepEqual(outcome, { status: 'completed' });
  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' },
    { type: 'agentToolCall', id: 'c1', name: 'read_file', input: { path: 'src/a.ts' } },
    { type: 'agentToolResult', id: 'c1', name: 'read_file', outcome: 'succeeded', summary: '{"ok":true,"result":{"text":"export const value = 1;"}}' },
    { type: 'assistantStreamCompleted' }
  ]);
});
