const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readExternalFileBytes,
  WorkspaceBoundaryError,
  WorkspaceLimitError
} = require('../dist/yisi/infrastructure/context/nodeWorkspaceFileSystem');

function tempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-external-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { dir, file };
}

test('reads an external file outside any workspace root by absolute path', async () => {
  const { dir, file } = tempFile('external.txt', 'hello external world');
  try {
    const bytes = await readExternalFileBytes(file);
    assert.equal(Buffer.from(bytes).toString('utf8'), 'hello external world');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a relative path as outside the external reader contract', async () => {
  await assert.rejects(() => readExternalFileBytes('relative.txt'), WorkspaceBoundaryError);
});

test('surfaces a missing external file as an ENOENT error, not a boundary error', async () => {
  const missing = path.join(os.tmpdir(), `yisi-no-such-${Date.now()}.txt`);
  await assert.rejects(
    () => readExternalFileBytes(missing),
    error => error && error.code === 'ENOENT'
  );
});

test('enforces the attachment size limit on external files', async () => {
  const { dir, file } = tempFile('big.txt', 'x'.repeat(1024));
  try {
    await assert.rejects(() => readExternalFileBytes(file, undefined, 10), WorkspaceLimitError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
