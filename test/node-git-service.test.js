const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const { parsePorcelain, NodeGitService } = require('../dist/yisi/infrastructure/git/nodeGitService');
const { NodeProcessRunner } = require('../dist/yisi/infrastructure/process/nodeProcessRunner');
const { isDirtyGitEntry } = require('../dist/yisi/domain/gitPort');

function git(dir, args) {
  cp.execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

test('parsePorcelain reads branch, renames, and statuses', () => {
  const result = parsePorcelain('## main...origin/main\n M src/a.ts\nA  b.ts\nR  old.ts -> new.ts\n?? untracked.txt\n');
  assert.equal(result.isRepo, true);
  assert.equal(result.branch, 'main');
  assert.equal(result.clean, false);
  assert.equal(result.entries.length, 4);
  assert.equal(result.entries[0].path, 'src/a.ts');
  assert.equal(result.entries[0].status, ' M');
  assert.equal(result.entries[1].status, 'A ');
  assert.equal(result.entries[2].renamedFrom, 'old.ts');
  assert.equal(result.entries[2].path, 'new.ts');
  assert.equal(result.entries[3].status, '??');
});

test('isDirtyGitEntry: untracked is clean, modified/renamed are dirty', () => {
  assert.equal(isDirtyGitEntry({ status: '??' }), false);
  assert.equal(isDirtyGitEntry({ status: ' M' }), true);
  assert.equal(isDirtyGitEntry({ status: 'M ' }), true);
  assert.equal(isDirtyGitEntry({ status: 'R ' }), true);
  assert.equal(isDirtyGitEntry({ status: 'A ' }), true);
});

test('status on a real git repo reports branch and dirtiness', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-git-'));
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'test']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-m', 'init']);

    const service = new NodeGitService(new NodeProcessRunner());
    assert.equal(await service.isRepo(dir), true);

    const clean = await service.status(dir);
    assert.equal(clean.isRepo, true);
    assert.equal(typeof clean.branch, 'string');
    assert.ok(clean.branch && clean.branch.length > 0);
    assert.equal(clean.clean, true);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    const dirty = await service.status(dir);
    assert.equal(dirty.clean, false);
    assert.equal(dirty.entries.some(entry => entry.path === 'a.txt' && entry.status === ' M'), true);
    assert.equal(await service.hasUncommittedChanges(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-repository reports isRepo false without throwing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-nogit-'));
  try {
    const service = new NodeGitService(new NodeProcessRunner());
    assert.equal(await service.isRepo(dir), false);
    const status = await service.status(dir);
    assert.equal(status.isRepo, false);
    assert.equal(status.clean, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
