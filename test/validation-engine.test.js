const test = require('node:test');
const assert = require('node:assert/strict');

const { ValidationEngine } = require('../dist/yisi/validation/validationEngine');

const output = text => ({
  text,
  totalBytes: Buffer.byteLength(text),
  retainedBytes: Buffer.byteLength(text),
  truncated: false
});

const processResult = (overrides = {}) => ({
  status: 'exited',
  exitCode: 0,
  signal: null,
  stdout: output('ok'),
  stderr: output(''),
  durationMs: 12,
  ...overrides
});

const step = (kind, overrides = {}) => ({
  kind,
  executable: process.execPath,
  args: ['--version'],
  cwd: process.cwd(),
  timeoutMs: 5_000,
  ...overrides
});

test('an empty validation plan is explicitly no evidence, never a pass', async () => {
  const engine = new ValidationEngine({ run: () => { throw new Error('must not run'); } });

  const result = await engine.validate([], new AbortController().signal);

  assert.deepEqual(result, { passed: false, reason: 'noEvidence', steps: [] });
});

test('runs command steps sequentially and returns bounded structured evidence', async () => {
  const calls = [];
  const results = [processResult(), processResult({ stdout: output('tests pass'), durationMs: 31 })];
  const engine = new ValidationEngine({
    run: async (request, signal) => {
      calls.push({ request, signal });
      return results.shift();
    }
  });
  const signal = new AbortController().signal;

  const result = await engine.validate([step('typecheck'), step('test')], signal);

  assert.equal(result.passed, true);
  assert.equal(result.reason, 'completed');
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].stdout.text, 'tests pass');
  assert.equal(result.steps[1].durationMs, 31);
  assert.equal(result.steps[1].summary, 'test passed (exit 0).');
  assert.equal(calls[0].signal, signal);
  assert.equal(calls[1].request.executable, process.execPath);
});

test('stops at the first non-zero exit and does not run later steps', async () => {
  let calls = 0;
  const engine = new ValidationEngine({
    run: async () => {
      calls += 1;
      return processResult({ exitCode: 2, stderr: output('compile failed') });
    }
  });

  const result = await engine.validate([step('build'), step('test')], new AbortController().signal);

  assert.equal(result.passed, false);
  assert.equal(result.reason, 'failed');
  assert.equal(result.steps[0].summary, 'build failed (exit 2).');
  assert.equal(result.steps[0].stderr.text, 'compile failed');
  assert.equal(calls, 1);
});

test('normalizes timeout, cancellation, and spawn failures as terminal evidence', async () => {
  for (const [status, reason, summary] of [
    ['timedOut', 'timedOut', 'lint timed out.'],
    ['cancelled', 'cancelled', 'lint cancelled.'],
    ['spawnFailed', 'failed', 'lint could not start.']
  ]) {
    const engine = new ValidationEngine({
      run: async () => processResult({ status, exitCode: null })
    });
    const result = await engine.validate([step('lint')], new AbortController().signal);
    assert.equal(result.reason, reason);
    assert.equal(result.steps[0].summary, summary);
  }
});

test('never echoes validation environment values into evidence', async () => {
  const secret = 'validation-secret';
  const engine = new ValidationEngine({ run: async () => processResult() });

  const result = await engine.validate([
    step('ruyi', { env: { YISI_VALIDATION_TOKEN: secret } })
  ], new AbortController().signal);

  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal('env' in result.steps[0].step, false);
});

test('rejects malformed shell-like validation steps before execution', async () => {
  let calls = 0;
  const engine = new ValidationEngine({ run: async () => { calls += 1; return processResult(); } });
  const invalid = [
    step('build', { executable: '' }),
    step('test', { args: 'npm test' }),
    step('lint', { args: ['ok', 42] }),
    step('typecheck', { cwd: '' })
  ];

  for (const candidate of invalid) {
    await assert.rejects(
      engine.validate([candidate], new AbortController().signal),
      /Invalid validation step/
    );
  }
  assert.equal(calls, 0);
});

test('uses workspace diagnostics as pass/fail evidence without spawning a process', async () => {
  let processCalls = 0;
  const snapshots = [
    {
      available: true, items: [], total: 1, truncated: true,
      counts: { error: 0, warning: 1, information: 0, hint: 0 }
    },
    {
      available: true,
      items: [{ uri: 'file:///workspace/a.ts', severity: 'error', message: 'broken' }],
      total: 1, truncated: false,
      counts: { error: 1, warning: 0, information: 0, hint: 0 }
    }
  ];
  const engine = new ValidationEngine(
    { run: async () => { processCalls += 1; return processResult(); } },
    { read: async () => snapshots.shift() }
  );

  const passing = await engine.validate([{ kind: 'diagnostics' }], new AbortController().signal);
  assert.equal(passing.passed, true);
  assert.equal(passing.reason, 'completed');
  assert.equal(passing.steps[0].summary, 'diagnostics passed (0 errors, 1 warning; retained items truncated).');
  assert.equal(passing.steps[0].snapshot.truncated, true);

  const failing = await engine.validate([{ kind: 'diagnostics' }], new AbortController().signal);
  assert.equal(failing.passed, false);
  assert.equal(failing.reason, 'failed');
  assert.equal(failing.steps[0].summary, 'diagnostics failed (1 error, 0 warnings).');
  assert.equal(processCalls, 0);
});

test('diagnostics unavailable is no evidence and never a pass', async () => {
  const engine = new ValidationEngine(
    { run: async () => processResult() },
    { read: async () => ({
      available: false, items: [], total: 0, truncated: false,
      counts: { error: 0, warning: 0, information: 0, hint: 0 }
    }) }
  );

  const result = await engine.validate([{ kind: 'diagnostics' }], new AbortController().signal);

  assert.equal(result.passed, false);
  assert.equal(result.reason, 'noEvidence');
  assert.equal(result.steps[0].summary, 'diagnostics unavailable.');
});

test('diagnostics step without a provider is unavailable evidence', async () => {
  const engine = new ValidationEngine({ run: async () => processResult() });
  const result = await engine.validate([{ kind: 'diagnostics' }], new AbortController().signal);
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'noEvidence');
});
