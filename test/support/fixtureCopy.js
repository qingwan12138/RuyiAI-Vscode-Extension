// A per-test copy of a checked-in fixture.
//
// Why this exists: the agent-loop e2e tests mutate the workspace they run in —
// they fix a bug in `calc.js` with the real edit tools. Running them directly
// against `test/fixtures/...` means the **repository working tree** is the shared
// mutable state, which has two consequences:
//
//   1. a run that fails or is interrupted leaves a modified checked-in file
//      behind, so the next run starts from a different baseline;
//   2. two runs touching the same checkout at once (a re-run while the previous
//      one is finishing, a watch-mode loop, two CI jobs on one runner) write and
//      read the same file concurrently — and the second one's `replace_text`
//      fails with "Workspace file changed since it was read", which is exactly
//      the "sha race" that was reported and never reproduced on a single run.
//
// Copying the fixture into a fresh temp directory removes the shared state
// entirely: the race is not made less likely, it becomes impossible.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/**
 * Copies `test/fixtures/<name>` to a fresh temp directory.
 * Returns the workspace root, the checked-in source (so a test can assert it was
 * left alone), and a cleanup function.
 */
function copyFixture(name) {
  const source = path.join(FIXTURES, name);
  if (!fs.existsSync(source)) throw new Error(`Unknown fixture: ${name}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `yisi-${name}-`));
  fs.cpSync(source, root, { recursive: true });
  return {
    root,
    source,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

module.exports = { copyFixture };
