const test = require('node:test');
const assert = require('node:assert/strict');

const { WorkspaceEditService, WorkspaceEditInputError } = require('../dist/yisi/application/edit/workspaceEditService');
const { isDirtyGitEntry } = require('../dist/yisi/domain/gitPort');

function gitMock(entries, isRepo = true) {
  return {
    async status(_cwd) { return { isRepo, branch: 'main', clean: entries.length === 0, entries, raw: '' }; },
    async isRepo(_cwd) { return isRepo; },
    async hasUncommittedChanges(_cwd) { return entries.length > 0; }
  };
}

function makeFiles() {
  const deleted = [];
  const renamed = [];
  return {
    deleted,
    renamed,
    async deleteFile(input) { deleted.push(input.path); return { path: input.path, beforeSha256: 'x' }; },
    async renameFile(input) { renamed.push([input.fromPath, input.toPath]); return { fromPath: input.fromPath, toPath: input.toPath }; },
    async replaceText() { throw new Error('unused'); },
    async createTextFile() { throw new Error('unused'); },
    async createDirectory() { throw new Error('unused'); },
    async rewriteTextFile() { throw new Error('unused'); }
  };
}

function makeReads() {
  return { async readFile(_path) { return { text: 'x', sha256: 'sha' }; } };
}

const signal = () => new AbortController().signal;

test('refuses to delete a path with tracked uncommitted changes', async () => {
  const files = makeFiles();
  const service = new WorkspaceEditService(files, undefined, makeReads(), gitMock([{ path: 'src/a.ts', status: ' M' }]), 'C:/repo');
  await assert.rejects(
    () => service.deleteFile({ path: 'src/a.ts' }, signal()),
    error => error instanceof WorkspaceEditInputError && /uncommitted/.test(error.message)
  );
  assert.equal(files.deleted.length, 0, 'delete must not reach the file system');
});

test('allows deleting a pure untracked (agent-created) file', async () => {
  const files = makeFiles();
  const service = new WorkspaceEditService(files, undefined, makeReads(), gitMock([{ path: 'src/a.ts', status: '??' }]), 'C:/repo');
  await service.deleteFile({ path: 'src/a.ts' }, signal());
  assert.deepEqual(files.deleted, ['src/a.ts']);
});

test('renaming away from a dirty path is refused', async () => {
  const files = makeFiles();
  const service = new WorkspaceEditService(files, undefined, makeReads(), gitMock([{ path: 'src/a.ts', status: ' M' }]), 'C:/repo');
  await assert.rejects(
    () => service.renameFile({ fromPath: 'src/a.ts', toPath: 'src/b.ts' }, signal()),
    error => error instanceof WorkspaceEditInputError && /uncommitted/.test(error.message)
  );
  assert.equal(files.renamed.length, 0, 'rename must not reach the file system');
});

test('a non-repo workspace skips the dirty guard', async () => {
  const files = makeFiles();
  const service = new WorkspaceEditService(files, undefined, makeReads(), gitMock([], false), 'C:/norepo');
  await service.deleteFile({ path: 'src/a.ts' }, signal());
  assert.deepEqual(files.deleted, ['src/a.ts']);
});

test('isDirtyGitEntry: untracked is clean, other statuses are dirty', () => {
  assert.equal(isDirtyGitEntry({ status: '??' }), false);
  assert.equal(isDirtyGitEntry({ status: ' M' }), true);
  assert.equal(isDirtyGitEntry({ status: 'R ' }), true);
});
