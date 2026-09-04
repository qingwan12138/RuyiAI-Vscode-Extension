const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  CommandExecutionService,
  CommandExecutionInputError,
  CommandExecutionDeniedError,
  createRunCommandTool,
  parseCommandInput
} = require('../dist/yisi/application/process/commandExecutionService');

const ROOT = path.resolve('C:/fake/workspace');

function fakeRunner(results = []) {
  const requests = [];
  return {
    requests,
    runner: {
      async run(request, signal) {
        requests.push({ request, signal });
        const next = results.shift();
        if (next) return next;
        return { status: 'exited', exitCode: 0, signal: null, stdout: empty(), stderr: empty(), durationMs: 5 };
      }
    }
  };
}

function empty() {
  return { text: '', totalBytes: 0, retainedBytes: 0, truncated: false };
}

function capture(text, truncated = false) {
  return { text, totalBytes: text.length, retainedBytes: text.length, truncated };
}

const signal = () => new AbortController().signal;

test('maps a successful process result into the structured tool result', async () => {
  const { runner, requests } = fakeRunner([{
    status: 'exited', exitCode: 0, signal: null,
    stdout: capture('All tests passed.'), stderr: empty(), durationMs: 321
  }]);
  const service = new CommandExecutionService(runner, ROOT);
  const result = await service.run({ executable: 'ctest', args: ['--test-dir', 'build'], cwd: 'proj' }, signal());

  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutText, 'All tests passed.');
  assert.equal(result.stderrText, '');
  assert.equal(result.durationMs, 321);
  assert.deepEqual(result.command, { executable: 'ctest', args: ['--test-dir', 'build'], cwd: path.join(ROOT, 'proj') });
  assert.equal(requests[0].request.executable, 'ctest');
  assert.equal(requests[0].request.cwd, path.join(ROOT, 'proj'));
});

test('surfaces failure, truncation and error message fields', async () => {
  const { runner } = fakeRunner([{
    status: 'exited', exitCode: 1, signal: null,
    stdout: capture('x'.repeat(300), true), stderr: capture('boom'), durationMs: 10
  }]);
  const service = new CommandExecutionService(runner, ROOT);
  const result = await service.run({ executable: 'cmake', args: ['--build', 'build'] }, signal());
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrText, 'boom');
});

test('tool factory declares processExec risk and correct schema', () => {
  const tool = createRunCommandTool(new CommandExecutionService({ run: async () => ({}) }, ROOT));
  assert.equal(tool.id, 'run_command');
  assert.equal(tool.risk, 'processExec');
  assert.equal(tool.mutatesWorkspace, true);
  assert.equal(tool.supportsCancellation, true);
  assert.deepEqual(tool.inputSchema.required, ['executable']);
});

test('defaults cwd to the workspace root', async () => {
  const { runner, requests } = fakeRunner();
  const service = new CommandExecutionService(runner, ROOT);
  await service.run({ executable: 'make' }, signal());
  assert.equal(requests[0].request.cwd, path.resolve(ROOT));
});

test('rejects invalid inputs', async () => {
  const service = new CommandExecutionService({ run: async () => ({}) }, ROOT);
  const invalid = [
    {},
    { executable: '' },
    { executable: 42 },
    { executable: 'a b' },
    { executable: '/usr/bin/cmake' },
    { executable: 'dir\\cmd' },
    { executable: '.hidden' },
    { executable: 'node', args: ['a', 1] },
    { executable: 'node', args: ['a', 'b'.repeat(4097)] },
    { executable: 'node', args: new Array(257).fill('a') },
    { executable: 'node', args: ['bad\0arg'] },
    { executable: 'node', cwd: '../escape' },
    { executable: 'node', cwd: '' },
    { executable: 'node', timeoutMs: 0 },
    { executable: 'node', timeoutMs: 1.5 },
    { executable: 'node', timeoutMs: 700000 },
    { executable: 'node', extra: true }
  ];
  for (const input of invalid) {
    await assert.rejects(
      () => service.run(input, signal()),
      /(Invalid command execution input|plain PATH command name|not allowed by the agent command policy|stay inside the workspace)/,
      JSON.stringify(input)
    );
  }
});

test('denies privilege/system/package executables before running', async () => {
  let ran = false;
  const service = new CommandExecutionService({ run: async () => { ran = true; } }, ROOT);
  for (const executable of ['sudo', 'su', 'apt-get', 'systemctl', 'pacman']) {
    await assert.rejects(() => service.run({ executable, args: ['x'] }, signal()), CommandExecutionDeniedError);
  }
  assert.equal(ran, false);
});

test('confinement check treats a nested workspace dir as allowed and traversal as denied', () => {
  const nested = parseCommandInput({ executable: 'ctest', cwd: 'build/ninja' }, ROOT);
  assert.equal(nested.cwd, path.join(path.resolve(ROOT), 'build', 'ninja'));

  const rootDir = parseCommandInput({ executable: 'ctest' }, ROOT);
  assert.equal(rootDir.cwd, path.resolve(ROOT));

  assert.throws(() => parseCommandInput({ executable: 'ctest', cwd: '..' }, ROOT), CommandExecutionInputError);
  assert.throws(() => parseCommandInput({ executable: 'ctest', cwd: '../outside' }, ROOT), CommandExecutionInputError);
  assert.throws(() => parseCommandInput({ executable: 'sudo' }, ROOT), CommandExecutionDeniedError);
});
