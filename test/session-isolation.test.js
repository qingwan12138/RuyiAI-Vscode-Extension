const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const { SessionIsolationService } = require('../dist/yisi/application/workspace/sessionIsolation');
const { WorktreeManagerService } = require('../dist/yisi/application/git/worktreeManagerService');
const { NodeWorktreeManager } = require('../dist/yisi/infrastructure/git/nodeWorktreeManager');
const { NodeGitService } = require('../dist/yisi/infrastructure/git/nodeGitService');
const { NodeProcessRunner } = require('../dist/yisi/infrastructure/process/nodeProcessRunner');

function git(dir, args) {
  cp.execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-iso-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

const signal = () => new AbortController().signal;

test('v0.4 DoD: two write sessions isolate onto distinct worktrees; the main tree stays unchanged', async () => {
  const repo = makeRepo();
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-isodir-'));
  const runner = new NodeProcessRunner();
  const worktrees = new WorktreeManagerService(new NodeWorktreeManager(runner), new NodeGitService(runner));
  const built = [];
  const isolation = new SessionIsolationService(repo, wtDir, worktrees, async (root, uri) => {
    built.push({ root, uri });
    return { root, uri, run: async () => 'ok' };
  });
  try {
    const a = await isolation.resolve({ sessionId: 's-a', mode: 'manual' });
    const b = await isolation.resolve({ sessionId: 's-b', mode: 'manual' });
    assert.ok(a && b);
    assert.notEqual(a.root, b.root, 'two write sessions get different worktrees');
    assert.equal(built.length, 2);

    // Each session writes to its own worktree; the main tree is untouched.
    fs.writeFileSync(path.join(built[0].root, 'a.txt'), 'from session A\n');
    fs.writeFileSync(path.join(built[1].root, 'a.txt'), 'from session B\n');
    assert.equal(fs.readFileSync(path.join(built[0].root, 'a.txt'), 'utf8'), 'from session A\n');
    assert.equal(fs.readFileSync(path.join(built[1].root, 'a.txt'), 'utf8'), 'from session B\n');
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'hello\n', 'shared working tree unaffected');

    // A reused session keeps its own worktree (no extra creation).
    const a2 = await isolation.resolve({ sessionId: 's-a', mode: 'manual' });
    assert.equal(a2.root, a.root);
    assert.equal(built.length, 2);

    // Read-only plan sessions run on the shared tree (no isolation).
    assert.equal(await isolation.resolve({ sessionId: 's-plan', mode: 'plan' }), undefined);
    assert.equal(built.length, 2);

    // Cleanup removes the session worktree.
    await isolation.cleanup('s-a');
    assert.equal(fs.existsSync(built[0].root), false);
  } finally {
    fs.rmSync(wtDir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a non-git workspace falls back to the shared runner instead of failing', async () => {
  const worktrees = {
    async createSessionWorktree() { throw new Error('Cannot create a git worktree outside a git repository.'); },
    async remove() {}
  };
  const built = [];
  const isolation = new SessionIsolationService(
    'C:/not-a-repo', '/tmp/wt', worktrees,
    async (root, uri) => { built.push(root); return { run: async () => 'x' }; },
    async () => false // isRepo -> false
  );
  assert.equal(await isolation.resolve({ sessionId: 's-plain', mode: 'manual' }), undefined);
  assert.equal(built.length, 0, 'no worktree attempted in a non-git workspace');
});

test('a worktree creation failure degrades to the shared runner (never fails the run)', async () => {
  const worktrees = { async createSessionWorktree() { throw new Error('boom'); }, async remove() {} };
  const isolation = new SessionIsolationService(
    'C:/repo', '/tmp/wt', worktrees,
    async () => ({ run: async () => 'x' }),
    async () => true
  );
  assert.equal(await isolation.resolve({ sessionId: 's-fail', mode: 'acceptEdits' }), undefined);
});
