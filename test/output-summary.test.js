const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { summarizeOutput } = require('../dist/yisi/application/process/outputSummary');
const { CommandExecutionService } = require('../dist/yisi/application/process/commandExecutionService');

test('passes small outputs through verbatim', () => {
  const summary = summarizeOutput('All tests passed.\n', 20, 20);
  assert.equal(summary.text, 'All tests passed.\n');
  assert.equal(summary.truncated, false);
  assert.equal(summary.totalCharacters, 18);
});

test('keeps head and tail with an explicit omission marker for long outputs', () => {
  const output = 'HEADLINE\n' + 'm'.repeat(2000) + '\nTAILERROR\n';
  const summary = summarizeOutput(output, 10, 12);
  assert.equal(summary.truncated, true);
  assert.ok(summary.text.startsWith('HEADLINE\nm'), 'keeps the head');
  assert.ok(summary.text.endsWith('TAILERROR\n'), 'keeps the tail');
  assert.match(summary.text, /middle output omitted/);
  assert.equal(summary.headCharacters, 10);
  assert.equal(summary.tailCharacters, 12);
  assert.equal(summary.totalCharacters, output.length);
});

test('run_command results carry summarized stdout/stderr alongside raw text', async () => {
  const longOut = 'x'.repeat(20000) + 'FAIL_LINE';
  const calls = [];
  const runner = {
    async run(request) {
      calls.push(request);
      return {
        status: 'exited', exitCode: 1, signal: null,
        stdout: { text: longOut, totalBytes: Buffer.byteLength(longOut), retainedBytes: Buffer.byteLength(longOut), truncated: false },
        stderr: { text: 'short err', totalBytes: 9, retainedBytes: 9, truncated: false },
        durationMs: 3
      };
    }
  };
  const service = new CommandExecutionService(runner, path.resolve('C:/fake/ws'));
  const result = await service.run({ executable: 'ctest', args: ['--test-dir', 'build'] }, new AbortController().signal);

  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 1);
  // Raw fields are preserved for callers that need them.
  assert.equal(result.stdoutText, longOut);
  assert.equal(result.stdoutTruncated, false);
  // The summary is bounded: head(4000) + marker + tail(8000 max).
  assert.equal(result.stdoutSummary.truncated, true);
  assert.ok(result.stdoutSummary.text.includes('middle output omitted'));
  assert.ok(result.stdoutSummary.text.endsWith('FAIL_LINE'));
  assert.ok(result.stdoutSummary.text.length < longOut.length);
  assert.equal(result.stderrSummary.text, 'short err');
  assert.equal(result.stderrSummary.truncated, false);
});
