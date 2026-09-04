const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  WorkspaceEditService,
  WorkspaceEditInputError,
  createWorkspaceEditTool,
  createWorkspaceFileTool,
  createWorkspaceDeleteTool,
  createUndoLastEditTool,
  createWorkspaceDirectoryTool,
  createWorkspaceRenameTool
} = require('../dist/yisi/application/edit/workspaceEditService');
const { summarizeTextChange } = require('../dist/yisi/application/edit/editJournal');

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** In-memory repository implementing the read port and the write port. */
function repository(seed = {}) {
  const files = new Map(Object.entries(seed));
  const repo = {
    files,
    async readFile(relativePath) {
      const text = files.get(relativePath);
      if (text === undefined) {
        const error = new Error(`ENOENT ${relativePath}`);
        error.code = 'ENOENT';
        throw error;
      }
      return { path: relativePath, text, bytes: Buffer.byteLength(text), sha256: sha(text) };
    },
    async listDirectory() { return []; },
    async searchText() { return { matches: [], scannedFiles: 0, truncated: false }; },
    async replaceText(change) {
      const current = files.get(change.path);
      if (current === undefined) throw new Error('ENOENT');
      if (sha(current) !== change.expectedSha256) throw new Error('changed since it was read');
      const count = current.split(change.oldText).length - 1;
      if (count !== 1) throw new Error('must occur exactly once');
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
      if (sha(current) !== change.expectedSha256) throw new Error('changed since it was read');
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
      if (files.has(change.toPath)) throw new Error('target already exists');
      files.delete(change.fromPath);
      files.set(change.toPath, current);
      return { fromPath: change.fromPath, toPath: change.toPath };
    },
    async createDirectory() {
      return { path: 'x', created: true };
    }
  };
  return { repo, service: new WorkspaceEditService(repo, undefined, repo) };
}

const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal: new AbortController().signal };

test('undo reverts the most recent text replacement', async () => {
  const { repo, service } = repository({ 'notes.txt': 'hello world\nsecond line\n' });
  const before = await repo.readFile('notes.txt');
  const editTool = createWorkspaceEditTool(service);

  await editTool.execute({ path: 'notes.txt', expectedSha256: before.sha256, oldText: 'world', newText: 'moon' }, context);
  assert.equal(repo.files.get('notes.txt'), 'hello moon\nsecond line\n');

  const undo = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(undo.undone, true);
  assert.equal(undo.kind, 'replace_text');
  assert.equal(repo.files.get('notes.txt'), 'hello world\nsecond line\n');
});

test('undo refuses stale state when the file changed after the edit', async () => {
  const { repo, service } = repository({ 'notes.txt': 'alpha\n' });
  const before = await repo.readFile('notes.txt');
  await createWorkspaceEditTool(service).execute(
    { path: 'notes.txt', expectedSha256: before.sha256, oldText: 'alpha', newText: 'beta' },
    context
  );
  repo.files.set('notes.txt', 'changed by the user\n');

  const undo = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(undo.undone, false);
  assert.match(undo.reason, /changed after/i);
});

test('undo deletes a created file and recreates a deleted file', async () => {
  const { repo, service } = repository({ 'user.txt': 'keep me\n' });
  const createTool = createWorkspaceFileTool(service);
  const deleteTool = createWorkspaceDeleteTool(service);

  await createTool.execute({ path: 'made.ts', content: 'export const x = 1;\n' }, context);
  assert.ok(repo.files.has('made.ts'));
  let undo = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(undo.undone, true);
  assert.equal(undo.kind, 'create_text_file');
  assert.ok(!repo.files.has('made.ts'));

  const before = await repo.readFile('user.txt');
  await deleteTool.execute({ path: 'user.txt' }, context);
  assert.ok(!repo.files.has('user.txt'));
  undo = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(undo.undone, true);
  assert.equal(undo.kind, 'delete_file');
  assert.equal(repo.files.get('user.txt'), 'keep me\n');
});

test('rename reverses to its origin', async () => {
  const { repo, service } = repository({ 'a.txt': 'payload\n' });
  await createWorkspaceRenameTool(service).execute({ fromPath: 'a.txt', toPath: 'b.txt' }, context);
  assert.ok(!repo.files.has('a.txt'));
  assert.ok(repo.files.has('b.txt'));

  const undo = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(undo.undone, true);
  assert.equal(undo.kind, 'rename_file');
  assert.equal(repo.files.get('a.txt'), 'payload\n');
  assert.ok(!repo.files.has('b.txt'));
});

test('directory creation is journaled but reported non-reversible', async () => {
  const { repo, service } = repository({ 'seed.txt': 'x\n' });
  await createWorkspaceDirectoryTool(service).execute({ path: 'tests/unit' }, context);
  const undo = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(undo.undone, false);
  assert.match(undo.reason, /Directory removal is not automated/i);
  assert.equal(repo.files.get('seed.txt'), 'x\n');
});

test('journal is bounded so only recent edits stay revertible', async () => {
  const { repo, service } = repository({});
  for (let index = 1; index <= 8; index += 1) {
    await createWorkspaceFileTool(service).execute({ path: `f${index}.txt`, content: `${index}` }, context);
  }
  for (let index = 0; index < 6; index += 1) {
    const undo = await service.undoLastEdit({}, new AbortController().signal);
    assert.equal(undo.undone, true, `undo ${index}`);
  }
  // Oldest two creations fell out of the bounded journal.
  assert.ok(repo.files.has('f1.txt'));
  assert.ok(repo.files.has('f2.txt'));
  const empty = await service.undoLastEdit({}, new AbortController().signal);
  assert.equal(empty.undone, false);
  assert.match(empty.reason, /No agent workspace edits/);
});

test('undo tool metadata and input validation', async () => {
  const { repo, service } = repository({ 'x.txt': 'a\n' });
  const tool = createUndoLastEditTool(service);
  assert.equal(tool.id, 'undo_last_edit');
  assert.equal(tool.risk, 'workspaceWrite');
  assert.equal(tool.mutatesWorkspace, true);
  assert.deepEqual(tool.inputSchema.properties, {});
  await assert.rejects(() => service.undoLastEdit({ extra: 1 }, new AbortController().signal), WorkspaceEditInputError);
});

test('multiset change summary counts additions/removals without whole-file noise', () => {
  const summary = summarizeTextChange('a\nb\nc\n', 'a\nb\nc\nb\n');
  assert.equal(summary.addedLines, 1);
  assert.equal(summary.removedLines, 0);
  assert.deepEqual(summary.addedPreview, ['b']);

  const removed = summarizeTextChange('a\nx\ny\n', 'a\n');
  assert.equal(removed.removedLines, 2);
  assert.deepEqual(removed.removedPreview, ['x', 'y']);

  const unchanged = summarizeTextChange('same\n', 'same\n');
  assert.equal(unchanged.addedLines, 0);
  assert.equal(unchanged.removedLines, 0);
});
