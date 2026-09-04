const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCommandHint,
  chooseValidationHints,
  MAX_VALIDATION_RUNS
} = require('../dist/yisi/application/validation/commandPlan');
const {
  ValidationPlannerService,
  createRunValidationsTool
} = require('../dist/yisi/application/validation/validationPlannerService');

test('parses plain hints into structured runs', () => {
  assert.deepEqual(parseCommandHint('ctest --test-dir build'), {
    runs: [{ executable: 'ctest', args: ['--test-dir', 'build'] }]
  });
  assert.deepEqual(parseCommandHint('  mvn  -q test '), {
    runs: [{ executable: 'mvn', args: ['-q', 'test'] }]
  });
});

test('splits && chains into sequential runs without a shell', () => {
  assert.deepEqual(parseCommandHint('cmake -S . -B build && cmake --build build'), {
    runs: [
      { executable: 'cmake', args: ['-S', '.', '-B', 'build'] },
      { executable: 'cmake', args: ['--build', 'build'] }
    ]
  });
});

test('translates ./gradlew wrappers to explicit bash runs', () => {
  assert.deepEqual(parseCommandHint('./gradlew test'), {
    runs: [{ executable: 'bash', args: ['./gradlew', 'test'] }]
  });
});

test('refuses heads that cannot be executed structurally', () => {
  assert.match(parseCommandHint('/usr/bin/ctest').unsupported, /Unsupported command head/);
  assert.match(parseCommandHint('sudo make install').unsupported, /Privileged/);
  assert.match(parseCommandHint('a && b && c && d && e').unsupported, /too many segments/);
});

test('keeps double-quoted argument groups intact', () => {
  assert.deepEqual(parseCommandHint('grep -n "hello world" src'), {
    runs: [{ executable: 'grep', args: ['-n', 'hello world', 'src'] }]
  });
});

test('ranks test-ish hints first and bounds the plan size', () => {
  const chosen = chooseValidationHints(
    ['cmake -S . -B build && cmake --build build', 'ctest --test-dir build'],
    []
  );
  assert.deepEqual(chosen, ['ctest --test-dir build', 'cmake -S . -B build && cmake --build build']);
  assert.ok(chosen.length <= MAX_VALIDATION_RUNS);
  assert.equal(chooseValidationHints(['a', 'a', 'b'], []).length, 2);
});

function stubServices(runsToReturn) {
  const calls = [];
  const commands = {
    async run(input) {
      calls.push(input);
      const next = runsToReturn.shift();
      if (next) return next;
      return flatRun({ status: 'exited', exitCode: 0, stdoutText: '', stderrText: '', durationMs: 1 });
    }
  };
  const profile = {
    async inspect() {
      return {
        summary: 'x',
        profile: {
          languages: ['C', 'C++'],
          buildSystems: [{ kind: 'cmake', file: 'CMakeLists.txt', confidence: 'strong' }],
          testFrameworks: [{ kind: 'ctest', file: 'CMakeLists.txt', confidence: 'strong' }],
          testCommandHints: [
            'cmake -S . -B build && cmake --build build',
            'ctest --test-dir build'
          ],
          notes: []
        }
      };
    }
  };
  return { calls, planner: new ValidationPlannerService(commands, profile) };
}

function flatRun(overrides = {}) {
  return {
    command: { executable: 'x', args: [] },
    status: 'exited',
    exitCode: 0,
    durationMs: 1,
    stdoutText: '',
    stdoutTruncated: false,
    stderrText: '',
    stderrTruncated: false,
    ...overrides
  };
}

test('planner runs chosen validation commands and reports pass/fail evidence', async () => {
  const { calls, planner } = stubServices([
    flatRun({ exitCode: 0, stdoutText: 'All tests passed.', durationMs: 5 }),
    flatRun({ exitCode: 1, stderrText: 'configure failed', durationMs: 9 }),
    flatRun({ exitCode: 0, stdoutText: 'build ok', durationMs: 2 })
  ]);
  const report = await planner.validate(new AbortController().signal);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { executable: 'ctest', args: ['--test-dir', 'build'], cwd: '.' });
  assert.deepEqual(calls[1], { executable: 'cmake', args: ['-S', '.', '-B', 'build'], cwd: '.' });
  assert.deepEqual(calls[2], { executable: 'cmake', args: ['--build', 'build'], cwd: '.' });
  assert.equal(report.passed, false);
  assert.equal(report.runs.length, 3);
  assert.equal(report.runs[0].passed, true);
  assert.equal(report.runs[1].passed, false);
  assert.equal(report.runs[2].passed, true);
  assert.match(report.runs[0].stdoutTail, /All tests passed/);
  assert.match(report.runs[1].stderrTail, /configure failed/);
  assert.deepEqual(report.profile.languages, ['C', 'C++']);
});

test('planner reports skipped unsupported hints without failing the whole pass', async () => {
  const { planner } = stubServices([]);
  // Force an unsupported hint by overriding the stub profile command list.
  const unsupportedPlanner = new ValidationPlannerService(
    { run: async () => { throw new Error('must not run'); } },
    {
      async inspect() {
        return {
          summary: 'x',
          profile: {
            languages: [],
            buildSystems: [],
            testFrameworks: [],
            testCommandHints: ['sudo make install'],
            notes: []
          }
        };
      }
    }
  );
  const report = await unsupportedPlanner.validate(new AbortController().signal);
  assert.equal(report.runs.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0], /Privileged/);
  assert.equal(report.passed, true, 'nothing ran, so nothing failed');
});

test('run_validations tool declares processExec metadata and empty schema', async () => {
  const { planner } = stubServices([]);
  const tool = createRunValidationsTool(planner);
  assert.equal(tool.id, 'run_validations');
  assert.equal(tool.risk, 'processExec');
  assert.equal(tool.mutatesWorkspace, true);
  assert.equal(tool.supportsCancellation, true);
  assert.deepEqual(tool.inputSchema.properties, {});
});
