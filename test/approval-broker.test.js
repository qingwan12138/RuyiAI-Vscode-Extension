const test = require('node:test');
const assert = require('node:assert/strict');

const { ApprovalBroker } = require('../dist/yisi/application/agent/approvalBroker');

test('posts a request when a view is attached and resolves on the answer', async () => {
  const posted = [];
  const broker = new ApprovalBroker();
  broker.attachPost(message => posted.push(message));

  const pending = broker.request('r1', 'Run the proposed command?', '$ node --test');

  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'toolApprovalRequest');
  assert.equal(posted[0].requestId, 'r1');
  assert.equal(broker.hasPending(), true);

  broker.resolve('r1', true);
  assert.equal(await pending, true);
  assert.equal(broker.hasPending(), false);
});

test('resolves false immediately when no view is attached', async () => {
  const broker = new ApprovalBroker();
  const result = await broker.request('r2', 'message', 'detail');
  assert.equal(result, false);
});

test('an abort signal resolves the pending request as declined', async () => {
  const broker = new ApprovalBroker();
  broker.attachPost(() => {});
  const controller = new AbortController();
  const pending = broker.request('r3', 'message', 'detail', controller.signal);
  assert.equal(broker.hasPending(), true);
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(broker.hasPending(), false);
});

test('cancelAll fails every pending approval (view disposed mid-run)', async () => {
  const broker = new ApprovalBroker();
  broker.attachPost(() => {});
  const first = broker.request('r4', 'a', 'a');
  const second = broker.request('r5', 'b', 'b');
  broker.cancelAll();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(broker.hasPending(), false);
});

test('ignores responses for unknown request ids and detach disables new posting', async () => {
  const posted = [];
  const broker = new ApprovalBroker();
  broker.attachPost(message => posted.push(message));
  const pending = broker.request('r6', 'm', 'd');
  broker.resolve('unknown', true);           // no-op for an unknown id
  broker.detachPost();
  assert.equal(broker.hasPending(), true);   // an in-flight request is not auto-settled
  broker.cancelAll();
  assert.equal(await pending, false);
  const afterDetach = await broker.request('r7', 'm', 'd');
  assert.equal(afterDetach, false);
});
