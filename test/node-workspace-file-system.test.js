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
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('atomically replaces one text occurrence with a stale hash guard', async t => {
  const { root, adapter } = await fixture(t);
  const before = await adapter.readFile('README.md');

  const result = await adapter.replaceText({
    path: 'README.md',
    expectedSha256: before.sha256,
    oldText: 'needle in readme',
    newText: 'updated heading'
  });

  assert.equal(result.path, 'README.md');
  assert.equal(result.beforeSha256, before.sha256);
  assert.match(result.afterSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(result.afterSha256, before.sha256);
  assert.equal(result.replacements, 1);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'updated heading\r\nsecond line\r\n');
});

test('preserves the existing file mode across replacement', async t => {
  const { root, adapter } = await fixture(t);
  const target = path.join(root, 'script.sh');
  await fs.writeFile(target, '#!/bin/sh\necho before\n');
  await fs.chmod(target, 0o755);
  const modeBefore = (await fs.stat(target)).mode & 0o7777;
  const before = await adapter.readFile('script.sh');

  await adapter.replaceText({
    path: 'script.sh', expectedSha256: before.sha256,
    oldText: 'echo before', newText: 'echo after'
  });

  assert.equal((await fs.stat(target)).mode & 0o7777, modeBefore);
});

test('rejects stale, missing, duplicate, sensitive, and cancelled replacements without mutation', async t => {
  const { root, adapter } = await fixture(t);
  const before = await adapter.readFile('README.md');
  const base = { path: 'README.md', expectedSha256: before.sha256, oldText: 'needle', newText: 'changed' };

  await assert.rejects(adapter.replaceText({ ...base, expectedSha256: '0'.repeat(64) }), /changed since/i);
  await assert.rejects(adapter.replaceText({ ...base, oldText: 'missing' }), /exactly once/i);
  await fs.writeFile(path.join(root, 'duplicate.txt'), 'same same');
  const duplicate = await adapter.readFile('duplicate.txt');
  await assert.rejects(adapter.replaceText({ ...base, path: 'duplicate.txt', expectedSha256: duplicate.sha256, oldText: 'same' }), /exactly once/i);
  await fs.writeFile(path.join(root, '.env'), 'TOKEN=secret');
  const sensitive = await adapter.readFile('.env');
  await assert.rejects(adapter.replaceText({ ...base, path: '.env', expectedSha256: sensitive.sha256, oldText: 'secret' }), /credential-sensitive/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.replaceText(base, controller.signal), error => error.name === 'AbortError');
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), before.text);
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
