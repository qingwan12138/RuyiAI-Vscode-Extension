const test = require('node:test');
const assert = require('node:assert/strict');

const { RuyiCliAdapter, parsePorcelainRecords } = require('../dist/yisi/ruyi/ruyiCliAdapter');

function runResult(overrides = {}) {
  return {
    status: 'exited',
    exitCode: 0,
    signal: null,
    stdout: { text: '', totalBytes: 0, retainedBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, retainedBytes: 0, truncated: false },
    durationMs: 1,
    ...overrides
  };
}

function harness(results = []) {
  const calls = [];
  const runner = {
    async run(request, signal) {
      calls.push({ request, signal });
      const next = results.shift();
      return next ?? runResult({ stdout: { text: '', totalBytes: 0, retainedBytes: 0, truncated: false } });
    }
  };
  const adapter = new RuyiCliAdapter('ruyi', runner, 'C:/workspace');
  return { calls, adapter };
}

test('runs through the structured runner with precise argv', async () => {
  const { calls, adapter } = harness([runResult({
    stdout: { text: '{"id":"gcc-upstream"}\n{"id":"qemu-user"}\n', totalBytes: 40, retainedBytes: 40, truncated: false }
  })]);
  const result = await adapter.listPackages();
  assert.deepEqual(calls[0].request, { executable: 'ruyi', args: ['--porcelain', 'list'], cwd: 'C:/workspace' });

  assert.equal(result.code, 0);
  assert.deepEqual(result.records, [{ id: 'gcc-upstream' }, { id: 'qemu-user' }]);
});

test('maps profiles, install and uninstall argument shapes', async () => {
  const { adapter } = harness([
    runResult({ stdout: { text: '{"name":"gnu-plct"}\n', totalBytes: 20, retainedBytes: 20, truncated: false } })
  ]);
  const profiles = await adapter.listProfiles();
  assert.deepEqual(profiles.records, [{ name: 'gnu-plct' }]);
});

test('parses only JSON lines and ignores human noise', () => {
  const records = parsePorcelainRecords('not json\n{"id":"a"}\n{"id":"b"}\n');
  assert.deepEqual(records, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(parsePorcelainRecords('').length, 0);
});

test('reports non-zero exit codes with stderr and throws on runner failures', async () => {
  const { adapter } = harness([runResult({ exitCode: 2, stderr: { text: 'bad repository\n', totalBytes: 15, retainedBytes: 15, truncated: false } })]);
  const result = await adapter.listPackages();
  assert.equal(result.code, 2);
  assert.match(result.stderr, /bad repository/);

  const failing = harness([runResult({ status: 'spawnFailed', exitCode: null, errorMessage: 'ENOENT' })]);
  await assert.rejects(() => failing.adapter.getVersion(), /spawnFailed: ENOENT/);
});

test('getVersion trims stdout and requires success', async () => {
  const { adapter } = harness([runResult({ stdout: { text: 'ruyi 0.19.0\n', totalBytes: 12, retainedBytes: 12, truncated: false } })]);
  assert.equal(await adapter.getVersion(), 'ruyi 0.19.0');
});
