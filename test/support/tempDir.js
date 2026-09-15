'use strict';

// System temp directories that clean themselves up.
//
// The defect this exists to prevent: `fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-x-'))`
// followed by no cleanup at all. Nothing fails, no assertion trips -- the machine just
// accumulates `yisi-*` directories with real files in them on every single run. Two test
// files did exactly that and had left 327 directories (119 non-empty) behind before
// anyone noticed, because a test that leaks cannot fail.
//
// So cleanup is not left to the caller's discipline. Creating a directory through this
// helper registers it, and a process-exit hook removes whatever is still there --
// including when a test throws or the file bails out early. Forgetting is not possible,
// which is the property a guard can then enforce.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Every directory created through this module that still exists. */
const live = new Set();
let hooked = false;

function hookExit() {
  if (hooked) return;
  hooked = true;
  // `exit` handlers must be synchronous, and this one has to run even after a failure.
  process.on('exit', () => {
    for (const dir of [...live]) remove(dir);
  });
}

function remove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A temp directory that cannot be removed must not turn into a failed test run:
    // the leak is already reported by the hygiene guard, and throwing here would
    // replace the real test result with a cleanup error.
  }
  live.delete(dir);
}

/** `fs.mkdtempSync`, registered for removal. */
function tempDirSync(prefix) {
  hookExit();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  live.add(dir);
  return dir;
}

/** The async form of the same thing. */
async function tempDir(prefix) {
  hookExit();
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  live.add(dir);
  return dir;
}

/**
 * Removes everything created so far, now rather than at exit. Returns how many
 * directories were actually there, so a caller can assert on it.
 */
function cleanupAll() {
  let removed = 0;
  for (const dir of [...live]) {
    if (fs.existsSync(dir)) removed += 1;
    remove(dir);
  }
  return removed;
}

/** The directories this process created that still exist (for assertions and diagnostics). */
function liveTempDirs() {
  return [...live].filter(dir => fs.existsSync(dir));
}

module.exports = { tempDirSync, tempDir, cleanupAll, liveTempDirs };
