const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  NodeWorkspaceFileSystem,
  WorkspaceBoundaryError,
  WorkspaceContentError,
  WorkspaceLimitError
} = require('../dist/yisi/infrastructure/context/nodeWorkspaceFileSystem');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yisi-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'Alpha.ts'), 'const needle = "first";\n');
  await fs.writeFile(path.join(root, 'README.md'), 'needle in readme\r\nsecond line\r\n');
  return { root, adapter: await NodeWorkspaceFileSystem.create(root) };
}

test('reads UTF-8 text and preserves workspace-relative identity and EOL', async t => {
  const { adapter } = await fixture(t);
  const result = await adapter.readFile('README.md');

  assert.equal(result.path, 'README.md');
  assert.equal(result.text, 'needle in readme\r\nsecond line\r\n');
  assert.equal(result.bytes, Buffer.byteLength(result.text));
});

test('rejects absolute paths and traversal before filesystem access', async t => {
  const { root, adapter } = await fixture(t);

  await assert.rejects(adapter.readFile(path.resolve(root, 'README.md')), WorkspaceBoundaryError);
  await assert.rejects(adapter.readFile('../outside.txt'), WorkspaceBoundaryError);
  await assert.rejects(adapter.readFile('src/../../outside.txt'), WorkspaceBoundaryError);
  await assert.rejects(adapter.readFile(''), WorkspaceBoundaryError);
});

test('rejects symlinks that escape the canonical workspace', async t => {
  const { root, adapter } = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'yisi-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const target = path.join(outside, 'secret.txt');
  await fs.writeFile(target, 'outside secret');
  try {
    await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Symlink creation is unavailable on this Windows host.');
      return;
    }
    throw error;
  }

  await assert.rejects(adapter.readFile('escape/secret.txt'), WorkspaceBoundaryError);
});

test('rejects binary, invalid UTF-8, and oversized files', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([1, 0, 2]));
  await fs.writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
  await fs.writeFile(path.join(root, 'large.txt'), '123456789');
  const adapter = await NodeWorkspaceFileSystem.create(root, { maxReadBytes: 8 });

  await assert.rejects(adapter.readFile('binary.bin'), WorkspaceContentError);
  await assert.rejects(adapter.readFile('invalid.txt'), WorkspaceContentError);
  await assert.rejects(adapter.readFile('large.txt'), WorkspaceLimitError);
});

test('lists stable entries without traversing symlinks', async t => {
  const { adapter } = await fixture(t);
  const entries = await adapter.listDirectory('.');

  assert.deepEqual(entries.map(entry => [entry.path, entry.kind]), [
    ['README.md', 'file'],
    ['src', 'directory']
  ]);
});

test('searches literal text while skipping implicit ignore and credential files', async t => {
  const { root, adapter } = await fixture(t);
  await fs.writeFile(path.join(root, '.gitignore'), 'needle should not become model context');
  await fs.writeFile(path.join(root, '.env'), 'TOKEN=needle-must-stay-local');
  await fs.writeFile(path.join(root, '.npmrc'), '//registry.example/:_authToken=needle-secret');

  const result = await adapter.searchText('needle', '.');

  assert.deepEqual(result.matches.map(match => [match.path, match.line, match.preview]), [
    ['README.md', 1, 'needle in readme'],
    ['src/Alpha.ts', 1, 'const needle = "first";']
  ]);
  assert.equal(result.truncated, false);
  assert.equal(result.scannedFiles, 2);
});

test('bounds listing and search results and supports cancellation', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'extra.txt'), 'needle one\nneedle two\n');
  const adapter = await NodeWorkspaceFileSystem.create(root, {
    maxDirectoryEntries: 1,
    maxSearchResults: 1
  });

  await assert.rejects(adapter.listDirectory('.'), WorkspaceLimitError);
  const search = await adapter.searchText('needle', '.');
  assert.equal(search.matches.length, 1);
  assert.equal(search.truncated, true);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.searchText('needle', '.', controller.signal), error => error.name === 'AbortError');
});
