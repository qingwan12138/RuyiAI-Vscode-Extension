const test = require('node:test');
const assert = require('node:assert/strict');

const { GitStatusService, createGitStatusTool } = require('../dist/yisi/application/git/gitStatusService');

test('git_status tool is read-only and returns bounded changed files', async () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({ path: `f${index}.ts`, status: ' M' }));
  const git = {
    async status(_cwd) {
      return { isRepo: true, branch: 'main', clean: false, entries, raw: entries.map(e => ' M ' + e.path).join('\n') };
    },
    async isRepo() { return true; },
    async hasUncommittedChanges() { return true; }
  };
  const tool = createGitStatusTool(new GitStatusService(git), 'C:/repo');

  assert.equal(tool.id, 'git_status');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);

  const result = await tool.execute({}, { signal: new AbortController().signal });
  assert.equal(result.isRepo, true);
  assert.equal(result.branch, 'main');
  assert.equal(result.clean, false);
  assert.equal(result.changedFiles.length, 300); // capped
  assert.equal(result.changedFiles[0].path, 'f0.ts');
});

test('git_status caps changed files at the configured limit', async () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({ path: `f${index}.ts`, status: ' M' }));
  const git = { async status() { return { isRepo: true, branch: null, clean: false, entries, raw: '' }; } };
  const tool = createGitStatusTool(new GitStatusService(git), 'C:/repo');
  const result = await tool.execute({}, { signal: new AbortController().signal });
  assert.equal(result.changedFiles.length, 300);
});
