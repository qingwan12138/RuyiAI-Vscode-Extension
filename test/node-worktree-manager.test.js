const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const { NodeWorktreeManager, parseWorktreeList } = require('../dist/yisi/infrastructure/git/nodeWorktreeManager');
const { NodeGitService } = require('../dist/yisi/infrastructure/git/nodeGitService');
const { NodeProcessRunner } = require('../dist/yisi/infrastructure/process/nodeProcessRunner');
const { WorktreeManagerService, createGitWorktreeTool } = require('../dist/yisi/application/git/worktreeManagerService');

function git(dir, args) {
  cp.execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-wt-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

const signal = () => new AbortController().signal;
function toPosix(value) { return value.replace(/\\/g, '/'); }

test('parseWorktreeList reads main + detached + branch entries', () => {
  const entries = parseWorktreeList('worktree /repo/main\nHEAD 00000\nbranch refs/heads/main\n\nworktree /repo/wt2\nHEAD 11111\nbranch refs/heads/yisi/session-abc\n\nworktree /repo/detached\nHEAD 22222\n');
  assert.equal(entries.length, 3);
  assert.equal(entries[0].path, '/repo/main');
  assert.equal(entries[0].branch, 'main');
  assert.equal(entries[0].isCurrent, true);
  assert.equal(entries[1].branch, 'yisi/session-abc');
  assert.equal(entries[1].isCurrent, false);
  assert.equal(entries[2].branch, null); // detached
});

test('creates an isolated session worktree and lists it', async () => {
  const repo = makeRepo();
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-wtdir-'));
  const runner = new NodeProcessRunner();
  const git = new NodeGitService(runner);
  const manager = new NodeWorktreeManager(runner);
  const service = new WorktreeManagerService(manager, git);
  try {
    const isolated = await service.createSessionWorktree(repo, 's-123', wtDir, signal());
    assert.equal(isolated.branch, 'yisi/session-s-123');
    assert.ok(fs.existsSync(isolated.root), 'worktree directory exists');

    const list = await service.list(repo, signal());
    assert.equal(list.length, 2);
    assert.equal(list.filter(item => item.isCurrent).length, 1, 'one current/main worktree');
    assert.ok(list.some(item => item.path === toPosix(isolated.root) && item.branch === 'yisi/session-s-123'));

    // A write inside the isolated worktree is isolated from the main tree.
    fs.writeFileSync(path.join(isolated.root, 'a.txt'), 'changed in session\n');
    assert.equal(await service.hasUncommittedChanges(isolated.root, signal()), true);
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'hello\n', 'main tree unchanged');
  } finally {
    fs.rmSync(wtDir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('refuses to remove a dirty worktree unless forced', async () => {
  const repo = makeRepo();
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-wtdir2-'));
  const runner = new NodeProcessRunner();
  const service = new WorktreeManagerService(new NodeWorktreeManager(runner), new NodeGitService(runner));
  let isolated;
  try {
    isolated = await service.createSessionWorktree(repo, 's-dirty', wtDir, signal());
    fs.writeFileSync(path.join(isolated.root, 'a.txt'), 'dirty\n');
    await assert.rejects(() => service.remove(repo, isolated.root, false, signal()), /uncommitted|dirty|not empty/i);
    await service.remove(repo, isolated.root, true, signal());
    assert.equal(fs.existsSync(isolated.root), false);
    assert.equal((await service.list(repo, signal())).length, 1);
  } finally {
    fs.rmSync(wtDir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('git_worktree tool validates action and lists worktrees', async () => {
  const repo = makeRepo();
  const runner = new NodeProcessRunner();
  const service = new WorktreeManagerService(new NodeWorktreeManager(runner), new NodeGitService(runner));
  const tool = createGitWorktreeTool(service, repo);
  try {
    assert.equal(tool.risk, 'processExec');
    assert.equal(tool.mutatesWorkspace, true);
    const result = await tool.execute({ action: 'list' }, { signal: signal() });
    assert.ok(Array.isArray(result.worktrees));
    assert.equal(result.worktrees.length, 1);
    await assert.rejects(() => tool.execute({ action: 'remove' }, { signal: signal() }), /path/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
