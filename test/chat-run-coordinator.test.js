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

  await coordinator.start('hello');

  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' },
    { type: 'assistantStreamDelta', text: 'Hel' },
    { type: 'assistantStreamDelta', text: 'lo' },
    { type: 'assistantStreamCompleted' }
  ]);
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
  await running;

  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' },
    { type: 'runStopped' }
  ]);
  assert.equal(coordinator.stop(), false);
});

test('normalizes failures without exposing arbitrary objects', async () => {
  const events = [];
  const coordinator = new ChatRunCoordinator(
    { async send() { throw new Error('provider unavailable'); } },
    event => events.push(event)
  );

  await coordinator.start('hello');

  assert.deepEqual(events, [
    { type: 'assistantStreamStarted' },
    { type: 'sessionError', message: 'provider unavailable' }
  ]);
});
