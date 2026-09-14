// The process-backed hook executor, driven against a real child process.
//
// test/hooks.test.js covers the decision logic with a stub executor; this file is
// about the parts that only exist with a real process: the stdin/stdout contract,
// what counts as valid output, failures, timeouts and cancellation.
//
// The security-relevant case is `--unknown` (a hook printing a decision the port
// does not define): it must be an error, never something that could be read as
// permission.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { NodeHookExecutor } = require('../dist/yisi/infrastructure/hooks/nodeHookExecutor');
const { HookService } = require('../dist/yisi/application/hooks/hookService');

const SCRIPT = path.join(__dirname, 'fixtures', 'hook-script.js');
const EXECUTABLE = process.execPath;
const SIGNAL = new AbortController().signal;

function hookFor(mode, overrides = {}) {
  return {
    event: 'preToolUse',
    command: EXECUTABLE,
    args: [SCRIPT, mode],
    match: '*',
    timeoutMs: 5_000,
    onError: 'block',
    ...overrides
  };
}

const PAYLOAD = {
  event: 'preToolUse',
  tool: { id: 'replace_text', risk: 'workspaceWrite', mutatesWorkspace: true },
  input: { path: 'a.txt', oldText: 'x' },
  sessionId: 's1'
};

test('a hook receives the event as JSON on stdin and can refuse', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(hookFor('--deny'), PAYLOAD, SIGNAL);
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason, 'the guardrail says no');
  assert.equal(result.error, undefined);
});

test('the payload arrives intact, including the tool input', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(hookFor('--echo'), PAYLOAD, SIGNAL);
  const echoed = JSON.parse(result.context);
  assert.equal(echoed.tool.id, 'replace_text');
  assert.deepEqual(echoed.input, { path: 'a.txt', oldText: 'x' });
  assert.equal(echoed.sessionId, 's1');
});

test('an allow decision is returned as-is, with its context', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(hookFor('--allow'), PAYLOAD, SIGNAL);
  assert.equal(result.decision, 'allow');
  assert.equal(result.context, 'seen:replace_text');
});

test('no output means no opinion, not a refusal', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(hookFor('--empty'), PAYLOAD, SIGNAL);
  assert.deepEqual(result, {});
});

test('plain text is context for a post-tool hook but an error for a pre-tool hook', async () => {
  const executor = new NodeHookExecutor();
  const post = await executor.execute(hookFor('--plain', { event: 'postToolUse' }), PAYLOAD, SIGNAL);
  assert.equal(post.context, 'lint: 2 warnings, 0 errors');
  assert.equal(post.error, undefined);

  // A decision needs structure; guessing at prose would be worse than failing.
  const pre = await executor.execute(hookFor('--plain'), PAYLOAD, SIGNAL);
  assert.match(pre.error, /not JSON/);
  assert.equal(pre.decision, undefined);
});

test('malformed output is an error, never silently ignored', async () => {
  const executor = new NodeHookExecutor();
  const garbage = await executor.execute(hookFor('--garbage'), PAYLOAD, SIGNAL);
  assert.match(garbage.error, /not JSON/);

  const array = await executor.execute(hookFor('--non-object'), PAYLOAD, SIGNAL);
  assert.match(array.error, /JSON object/);
});

test('an undefined decision is an error and cannot become permission', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(hookFor('--unknown'), PAYLOAD, SIGNAL);
  assert.match(result.error, /unknown decision/);
  assert.match(result.error, /allow.*deny/);
  assert.equal(result.decision, undefined, 'there is no verdict here that could widen anything');
});

test('a hook that exits non-zero reports its stderr', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(hookFor('--fail'), PAYLOAD, SIGNAL);
  assert.match(result.error, /exited with code 3/);
  assert.match(result.error, /hook exploded/);
});

test('a hook that never finishes is killed and reported, not waited on', async () => {
  const executor = new NodeHookExecutor();
  const started = Date.now();
  const result = await executor.execute(hookFor('--hang', { timeoutMs: 200 }), PAYLOAD, SIGNAL);
  assert.match(result.error, /did not finish within 200ms/);
  assert.ok(Date.now() - started < 5_000, 'the timeout has to actually bound the run');
});

test('a cancelled run kills the hook and reports cancellation', async () => {
  const executor = new NodeHookExecutor();
  const controller = new AbortController();
  const pending = executor.execute(hookFor('--hang', { timeoutMs: 30_000 }), PAYLOAD, controller.signal);
  setTimeout(() => controller.abort(), 50);
  const result = await pending;
  assert.match(result.error, /cancelled/);
});

test('an already-cancelled run does not even start a process', async () => {
  const executor = new NodeHookExecutor();
  const controller = new AbortController();
  controller.abort();
  const result = await executor.execute(hookFor('--allow'), PAYLOAD, controller.signal);
  assert.match(result.error, /cancelled/);
});

test('a missing executable is reported instead of hanging', async () => {
  const executor = new NodeHookExecutor();
  const result = await executor.execute(
    { ...hookFor('--allow'), command: 'yisi-definitely-not-a-real-binary' },
    PAYLOAD,
    SIGNAL
  );
  assert.ok(result.error, 'the failure must be visible');
});

test('the service and the real executor together refuse an action end to end', async () => {
  const service = new HookService([hookFor('--deny')], new NodeHookExecutor());
  const result = await service.preToolUse(
    { toolId: 'replace_text', risk: 'workspaceWrite', mutatesWorkspace: true, input: {}, sessionId: 's1' },
    SIGNAL
  );
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason, 'the guardrail says no');
});

test('a broken hook blocks by default through the service', async () => {
  const service = new HookService([hookFor('--fail')], new NodeHookExecutor());
  const result = await service.preToolUse(
    { toolId: 'replace_text', risk: 'workspaceWrite', mutatesWorkspace: true, input: {}, sessionId: 's1' },
    SIGNAL
  );
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /could not run/);
  assert.match(result.reason, /hook exploded/);
});
