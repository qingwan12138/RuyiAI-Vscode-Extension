// Temp-directory hygiene: a test that creates a system temp directory must clean it up.
//
// Why this guard exists at all: leaking is invisible. No assertion trips, no test fails --
// the machine simply accumulates `yisi-*` directories with real files in them. Two files
// did that until the handover was audited and found 327 leftover directories (119 with
// files). A defect that cannot fail a run has to be caught by something other than luck.
//
// The guard has two halves, and the second one is the important one:
//   1. a source scan: every file that creates a temp directory also references cleanup;
//   2. a real child process that creates a directory through the shared helper, exits,
//      and is checked to have left nothing behind. (1) alone would accept an `rm` that is
//      never reached; (2) proves the directory is actually gone after the process ends.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { tempDirSync, cleanupAll, liveTempDirs } = require('./support/tempDir');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');

function testFiles(dir = testDir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('every file that creates a system temp directory also cleans one up', () => {
  const offenders = [];
  for (const file of testFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/mkdtemp/.test(source)) continue;
    // Either the self-cleaning helper (preferred), or an explicit removal in the file.
    const cleansUp = /support\/tempDir/.test(source) || /rmSync\(|\brm\(/.test(source);
    if (!cleansUp) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(
    offenders,
    [],
    `these files create a temp directory and never remove it: ${offenders.join(', ')}. `
    + 'Use test/support/tempDir.js (tempDirSync / tempDir), which removes it on process exit.'
  );
});

test('the helper reports and removes what it created', () => {
  const before = liveTempDirs().length;
  const dir = tempDirSync('yisi-hygiene-');
  fs.writeFileSync(path.join(dir, 'proof.txt'), 'x', 'utf8');
  assert.equal(fs.existsSync(dir), true, 'the helper must actually create a directory');
  assert.equal(liveTempDirs().length, before + 1);

  const removed = cleanupAll();
  assert.ok(removed >= 1, `cleanupAll must report what it removed, got ${removed}`);
  assert.equal(fs.existsSync(dir), false, 'cleanupAll must remove the directory');
  assert.deepEqual(liveTempDirs(), [], 'nothing may be left registered');
});

test('a directory created through the helper is gone after the process exits', () => {
  // The half a source scan cannot prove: cleanup happens even though nothing in the
  // child calls it explicitly, and even though the child never finishes "normally".
  const helper = path.join(testDir, 'support', 'tempDir.js');
  const script = [
    `const { tempDirSync } = require(${JSON.stringify(helper)});`,
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const dir = tempDirSync('yisi-hygiene-child-');",
    "fs.writeFileSync(path.join(dir, 'proof.txt'), 'x');",
    'process.stdout.write(dir);'
  ].join('\n');

  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `the child failed: ${result.stderr}`);
  const created = result.stdout.trim();
  assert.ok(created.length > 0, 'the child must report the directory it created');
  assert.equal(
    fs.existsSync(created),
    false,
    `the child exited but left ${created} behind — the exit hook did not run`
  );
});
