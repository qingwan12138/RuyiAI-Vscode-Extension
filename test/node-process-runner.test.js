const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { NodeProcessRunner } = require('../dist/yisi/infrastructure/process/nodeProcessRunner');

const runner = new NodeProcessRunner();

function request(script, overrides = {}) {
  return {
    executable: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    timeoutMs: 5_000,
    outputLimitBytes: 8_192,
    terminationGraceMs: 100,
    ...overrides
  };
}

test('captures stdout, stderr, exact argv boundaries, cwd, and non-zero exit', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yisi process space '));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const script = [
    'console.log(JSON.stringify({args: process.argv.slice(1), cwd: process.cwd()}));',
    'console.error("failure tail");',
    'process.exitCode = 7;'
  ].join('');
  const result = await runner.run(request(script, {
    args: ['-e', script, 'a b', '$(not-a-shell)', ';still-literal'],
    cwd
  }), new AbortController().signal);

  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.deepEqual(JSON.parse(result.stdout.text.trim()), {
    args: ['a b', '$(not-a-shell)', ';still-literal'],
    cwd
  });
  assert.equal(result.stderr.text.trim(), 'failure tail');
  assert.equal(result.stdout.truncated, false);
  assert.ok(result.durationMs >= 0);
});

test('applies environment overrides but redacts their values from captured output', async () => {
  const secret = 'runner-secret-value';
  const result = await runner.run(request('console.log(process.env.YISI_RUNNER_SECRET)', {
    env: { YISI_RUNNER_SECRET: secret }
  }), new AbortController().signal);

  assert.equal(result.status, 'exited');
  assert.equal(result.stdout.text.trim(), '[REDACTED]');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('bounds stdout and stderr independently', async () => {
  const result = await runner.run(request(
    'process.stdout.write("abcdefghijklmnop"); process.stderr.write("1234567890abcdef");',
    { outputLimitBytes: 8 }
  ), new AbortController().signal);

  assert.equal(result.stdout.truncated, true);
  assert.equal(result.stdout.retainedBytes, 8);
  assert.equal(result.stdout.totalBytes, 16);
  assert.match(result.stdout.text, /abcd/);
  assert.match(result.stdout.text, /mnop/);
  assert.equal(result.stderr.truncated, true);
});

test('returns timedOut after terminating a long-running child', async () => {
  const result = await runner.run(request('setInterval(() => {}, 1000)', {
    timeoutMs: 60,
    terminationGraceMs: 20
  }), new AbortController().signal);

  assert.equal(result.status, 'timedOut');
  assert.equal(result.exitCode, null);
});

test('returns cancelled when AbortSignal stops a running child', async () => {
  const controller = new AbortController();
  const running = runner.run(request('setInterval(() => {}, 1000)'), controller.signal);
  setTimeout(() => controller.abort(), 60);
  const result = await running;

  assert.equal(result.status, 'cancelled');
  assert.equal(result.exitCode, null);
});

test('does not spawn when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runner.run({
    executable: path.join(process.cwd(), 'definitely-missing-yisi-executable'),
    args: [],
    cwd: process.cwd()
  }, controller.signal);

  assert.equal(result.status, 'cancelled');
  assert.equal(result.errorMessage, undefined);
});

test('normalizes spawn failure and does not reject the run promise', async () => {
  const result = await runner.run({
    executable: path.join(process.cwd(), 'definitely-missing-yisi-executable'),
    args: [],
    cwd: process.cwd(),
    timeoutMs: 1_000
  }, new AbortController().signal);

  assert.equal(result.status, 'spawnFailed');
  assert.equal(result.exitCode, null);
  assert.match(result.errorMessage, /ENOENT|not found/i);
  assert.ok(result.errorMessage.length <= 240);
});

test('rejects malformed requests before spawning', async () => {
  for (const invalid of [
    request('', { executable: '' }),
    request('', { args: ['ok', 42] }),
    request('', { cwd: '' }),
    request('', { timeoutMs: 0 }),
    request('', { outputLimitBytes: -1 })
  ]) {
    await assert.rejects(runner.run(invalid, new AbortController().signal), /Invalid process request/);
  }
});
