const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const notices = fs.readFileSync(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');

test('every runtime dependency is registered in THIRD_PARTY_NOTICES.md (licensing guard)', () => {
  const runtimeDeps = Object.keys(pkg.dependencies ?? {});
  const missing = runtimeDeps.filter(name => !notices.includes(name));
  assert.deepEqual(missing, [], 'Add package/version/license + usage note to THIRD_PARTY_NOTICES.md before shipping a new dependency.');
});

test('no unregistered native/build dependency is expected at runtime', () => {
  // The contract (docs/17, AGENTS.md) forbids native addons without approval;
  // a hint list reminds us not to silently add one.
  const forbidden = ['node-gyp', 'better-sqlite3', 'node-pty', 'nan'];
  const present = forbidden.filter(name => (pkg.dependencies ?? {})[name]);
  assert.deepEqual(present, [], 'Native addons require explicit architecture/ABI/license review before inclusion.');
});
