const test = require('node:test');
const assert = require('node:assert/strict');

const { RepoIndexService, createRepoIndexTool } = require('../dist/yisi/application/context/repoIndexService');

const signal = () => new AbortController().signal;

function mockFs(tree, gitignore) {
  return {
    async listDirectory(rel) { return tree[rel] ?? []; },
    async readFile(rel) {
      if (rel === '.gitignore') return { path: '.gitignore', text: gitignore, bytes: 1, sha256: 'x' };
      throw new Error('no file');
    }
  };
}

test('indexes a repo: counts languages, skips binaries/ignored/symlinks', async () => {
  const tree = {
    '.': [
      { path: 'src', name: 'src', kind: 'directory' },
      { path: 'README.md', name: 'README.md', kind: 'file' },
      { path: 'node_modules', name: 'node_modules', kind: 'directory' },
      { path: 'image.png', name: 'image.png', kind: 'file' },
      { path: 'package.json', name: 'package.json', kind: 'file' },
      { path: 'secret.txt', name: 'secret.txt', kind: 'file' },
      { path: 'link', name: 'link', kind: 'symlink' }
    ],
    src: [
      { path: 'main.ts', name: 'main.ts', kind: 'file' },
      { path: 'util.ts', name: 'util.ts', kind: 'file' }
    ]
  };
  const service = new RepoIndexService(mockFs(tree, 'node_modules\nimage.png\nsecret.txt\n'));
  const result = await service.index(signal());
  assert.equal(result.scannedFiles, 4); // README, package.json, main.ts, util.ts
  const byLang = Object.fromEntries(result.languages.map(item => [item.ext, item.files]));
  assert.equal(byLang.TypeScript, 2);
  assert.equal(byLang.Markdown, 1);
  assert.equal(byLang.JSON, 1);
  assert.ok(result.topLevel.some(entry => entry.path === 'src'));
  assert.equal(result.topLevel.some(entry => entry.path === 'node_modules'), false);
  assert.equal(result.truncated, false);
});

test('respects the maxFiles budget and reports truncation', async () => {
  const tree = { '.': Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.ts`, name: `f${i}.ts`, kind: 'file' })) };
  const service = new RepoIndexService(mockFs(tree, ''));
  const result = await service.index(signal(), { maxFiles: 5 });
  assert.equal(result.scannedFiles, 5);
  assert.equal(result.truncated, true);
});

test('returns promptly when the signal is aborted', async () => {
  const tree = { '.': [{ path: 'a.ts', name: 'a.ts', kind: 'file' }] };
  const service = new RepoIndexService(mockFs(tree, ''));
  const controller = new AbortController();
  controller.abort();
  const result = await service.index(controller.signal);
  assert.equal(result.truncated, true);
  assert.equal(result.scannedFiles, 0);
});

test('repo_index tool is read-only and bounded output', async () => {
  const tree = { '.': [{ path: 'a.ts', name: 'a.ts', kind: 'file' }, { path: 'b.py', name: 'b.py', kind: 'file' }] };
  const service = new RepoIndexService(mockFs(tree, ''));
  const tool = createRepoIndexTool(service);
  assert.equal(tool.id, 'repo_index');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);
  const result = await tool.execute({}, { signal: signal() });
  assert.ok(result.summary.includes('Languages'));
});
