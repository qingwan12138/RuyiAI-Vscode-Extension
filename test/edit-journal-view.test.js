const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { renderTextDiff } = require('../dist/yisi/application/edit/editJournal');
const {
  WorkspaceEditService,
  createWorkspaceEditTool,
  createWorkspaceFileTool,
  createWorkspaceDeleteTool,
  createWorkspaceRenameTool
} = require('../dist/yisi/application/edit/workspaceEditService');

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function repository(seed = {}) {
  const files = new Map(Object.entries(seed));
  const repo = {
    files,
    async readFile(relativePath) {
      const text = files.get(relativePath);
      if (text === undefined) { const e = new Error(`ENOENT ${relativePath}`); e.code = 'ENOENT'; throw e; }
      return { path: relativePath, text, bytes: Buffer.byteLength(text), sha256: sha(text) };
    },
    async listDirectory() { return []; },
    async searchText() { return { matches: [], scannedFiles: 0, truncated: false }; },
    async replaceText(change) {
      const current = files.get(change.path);
      if (current === undefined) throw new Error('ENOENT');
      const next = current.replace(change.oldText, change.newText);
      files.set(change.path, next);
      return { path: change.path, beforeSha256: sha(current), afterSha256: sha(next), replacements: 1, bytes: Buffer.byteLength(next) };
    },
    async createTextFile(change) {
      if (files.has(change.path)) throw new Error('already exists');
      files.set(change.path, change.content);
      return { path: change.path, sha256: sha(change.content), bytes: Buffer.byteLength(change.content) };
    },
    async rewriteTextFile(change) {
      const current = files.get(change.path);
      if (current === undefined) throw new Error('ENOENT');
      files.set(change.path, change.content);
      return { path: change.path, beforeSha256: sha(current), afterSha256: sha(change.content), bytes: Buffer.byteLength(change.content) };
    },
    async deleteFile(change) {
      const current = files.get(change.path);
      if (current === undefined) throw new Error('ENOENT');
      files.delete(change.path);
      return { path: change.path, beforeSha256: sha(current), bytes: Buffer.byteLength(current) };
    },
    async renameFile(change) {
      const current = files.get(change.fromPath);
      if (current === undefined) throw new Error('ENOENT');
      if (files.has(change.toPath)) throw new Error('exists');
      files.delete(change.fromPath);
      files.set(change.toPath, current);
      return { fromPath: change.fromPath, toPath: change.toPath };
    },
    async createDirectory() { return { path: 'x', created: true }; }
  };
  return { repo, service: new WorkspaceEditService(repo, undefined, repo) };
}

const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal: new AbortController().signal };

test('renderTextDiff shows unified-ish +/- lines and no-op text', () => {
  const diff = renderTextDiff('a\nb\nc\n', 'a\nB\nc\n', 'src/x.ts');
  assert.match(diff, /^--- src\/x\.ts \(before\)/m);
  assert.match(diff, /^\+\+\+ src\/x\.ts \(after\)/m);
  assert.match(diff, /^ a$/m);
  assert.match(diff, /^-b$/m);
  assert.match(diff, /^\+B$/m);
  assert.match(diff, /^ c$/m);
  assert.match(renderTextDiff('same\n', 'same\n', 'x'), /no line-level changes/);
});

test('journalSnapshot and journalDiffText expose bounded viewer data', async () => {
  const { repo, service } = repository({ 'notes.txt': 'hello\n' });
  const before = await repo.readFile('notes.txt');
  await createWorkspaceEditTool(service).execute(
    { path: 'notes.txt', expectedSha256: before.sha256, oldText: 'hello', newText: 'world' },
    context
  );

  const entries = service.journalSnapshot();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'replace_text');
  assert.equal(entries[0].isMostRecent, true);
  assert.equal(entries[0].reversibility, 'reversible');
  assert.equal(entries[0].removedLines, 1);
  assert.equal(entries[0].addedLines, 1);
  assert.deepEqual(entries[0].removedPreview, ['hello']);
  assert.deepEqual(entries[0].addedPreview, ['world']);

  const diff = service.journalDiffText(entries[0].id);
  assert.ok(diff);
  assert.match(diff.text, /^-hello$/m);
  assert.match(diff.text, /^\+world$/m);
});

test('snapshot marks only the newest entry and diff falls back for renames', async () => {
  const { repo, service } = repository({ 'a.txt': 'x\n' });
  await createWorkspaceFileTool(service).execute({ path: 'tmp.txt', content: 'v1\n' }, context);
  await createWorkspaceRenameTool(service).execute({ fromPath: 'a.txt', toPath: 'b.txt' }, context);

  const entries = service.journalSnapshot();
  assert.equal(entries.length, 2);
  assert.equal(entries[1].isMostRecent, true);
  assert.equal(entries[0].isMostRecent, false);

  const renameEntry = entries[1];
  const text = service.journalDiffText(renameEntry.id);
  assert.match(text.text, /renamed a\.txt → b\.txt/);
});

test('non-reversible entries carry their reason into the snapshot', async () => {
  const { service } = repository({ 'x.txt': 'a\n' });
  const { createWorkspaceDirectoryTool } = require('../dist/yisi/application/edit/workspaceEditService');
  await createWorkspaceDirectoryTool(service).execute({ path: 'tests' }, context);
  const entries = service.journalSnapshot();
  assert.equal(entries[0].reversibility, 'non-reversible');
  assert.match(entries[0].reason, /Directory removal is not automated/);
});
