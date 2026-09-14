// Checkpoints: turn-scoped recording, the rewind plan, and the two operations a
// checkpoint offers (rewind the code, fork the conversation).
//
// The properties worth protecting:
//   - a rewind is an ordinary **guarded** write, so a file the user edited since
//     the agent touched it is refused rather than clobbered;
//   - a partial rewind is reported honestly and the checkpoint is **kept**,
//     because a record that silently disagrees with the workspace is worse than
//     no record;
//   - the store is bounded, and anything that does not fit is marked as not
//     reversible with a reason instead of being silently dropped.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const { CheckpointStore } = require('../dist/yisi/application/edit/checkpointStore');
const { CheckpointService, forkTitle } = require('../dist/yisi/application/edit/checkpointService');
const { WorkspaceEditService } = require('../dist/yisi/application/edit/workspaceEditService');
const { SessionService } = require('../dist/yisi/application/session/sessionService');

const SIGNAL = new AbortController().signal;
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

/** An in-memory WorkspaceWritePort + FileSystemPort pair. */
function memoryWorkspace(initial = {}) {
  const files = new Map(Object.entries(initial));
  const requireFile = path => {
    const text = files.get(path);
    if (text === undefined) throw new Error('Workspace path is not a file.');
    return text;
  };
  const checkVersion = (path, expected) => {
    const before = requireFile(path);
    if (before !== undefined && expected && sha(before) !== expected) {
      throw new Error('Workspace file changed since it was read.');
    }
    return before;
  };
  return {
    files,
    sha,
    write: {
      async replaceText({ path, expectedSha256, oldText, newText }) {
        const before = checkVersion(path, expectedSha256);
        const first = before.indexOf(oldText);
        if (first < 0 || before.indexOf(oldText, first + 1) >= 0) throw new Error('Replacement source must be unique.');
        const after = before.slice(0, first) + newText + before.slice(first + oldText.length);
        files.set(path, after);
        return { path, beforeSha256: sha(before), afterSha256: sha(after), replacements: 1, bytes: after.length };
      },
      async createTextFile({ path, content }) {
        if (files.has(path)) throw new Error('Workspace path already exists.');
        files.set(path, content);
        return { path, sha256: sha(content), bytes: content.length };
      },
      async rewriteTextFile({ path, expectedSha256, content }) {
        const before = checkVersion(path, expectedSha256);
        files.set(path, content);
        return { path, beforeSha256: sha(before), afterSha256: sha(content), bytes: content.length };
      },
      async deleteFile({ path }) {
        const before = requireFile(path);
        files.delete(path);
        return { path, beforeSha256: sha(before), bytes: before.length };
      },
      async renameFile({ fromPath, toPath }) {
        const before = requireFile(fromPath);
        files.delete(fromPath);
        files.set(toPath, before);
        return { fromPath, toPath };
      },
      async createDirectory({ path }) {
        return { path, created: true };
      }
    },
    reads: {
      async readFile(path) {
        const text = files.get(path);
        if (text === undefined) throw new Error('ENOENT');
        return { path, text, bytes: text.length, sha256: sha(text) };
      }
    }
  };
}

function replacement(path, before, after) {
  return { path, expectedSha256: sha(before), oldText: before, newText: after };
}

// --- store -----------------------------------------------------------------

test('turns are ordered, labelled and carry the fork point', () => {
  const store = new CheckpointStore();
  store.startTurn('s1', 'first request', 0);
  store.record({ kind: 'create_text_file', path: 'a.txt', beforeText: null, afterText: 'A', reversible: true });
  store.endTurn();
  store.startTurn('s1', 'second request', 3);
  store.record({ kind: 'create_directory', path: 'd', beforeText: null, afterText: null, reversible: false, reason: 'not automated' });

  assert.deepEqual(store.turns('s1').map(turn => [turn.index, turn.label, turn.changes, turn.notReversible]), [
    [1, 'first request', 1, 0],
    [2, 'second request', 1, 1]
  ]);
  assert.equal(store.forkPoint('s1', store.turns('s1')[1].id), 3);
  assert.deepEqual(store.turns('other'), [], 'sessions do not share checkpoints');
});

test('changes are only recorded into an open turn', () => {
  const store = new CheckpointStore();
  store.record({ kind: 'create_text_file', path: 'orphan.txt', beforeText: null, afterText: 'x', reversible: true });
  assert.deepEqual(store.turns('s1'), [], 'a change outside a run is not attributed to anything');

  store.startTurn('s1', 'r', 0);
  store.endTurn();
  store.record({ kind: 'create_text_file', path: 'late.txt', beforeText: null, afterText: 'x', reversible: true });
  assert.equal(store.turns('s1')[0].changes, 0);
});

test('the rewind plan is newest-first, reverses within a turn, and stops at the target', () => {
  const store = new CheckpointStore();
  const change = (path) => ({ kind: 'create_text_file', path, beforeText: null, afterText: 'x', reversible: true });
  store.startTurn('s1', 'one', 0);
  store.record(change('a'));
  store.record(change('b'));
  store.endTurn();
  store.startTurn('s1', 'two', 2);
  store.record(change('c'));
  store.endTurn();

  const [one, two] = store.turns('s1');
  // Rewinding to a turn includes that turn: a checkpoint marks where it started.
  assert.deepEqual(store.rewindPlan('s1', one.id).map(c => c.path), ['c', 'b', 'a']);
  assert.deepEqual(store.rewindPlan('s1', two.id).map(c => c.path), ['c']);
  assert.deepEqual(store.rewindPlan('s1', undefined).map(c => c.path), ['c', 'b', 'a']);
  assert.deepEqual(store.rewindPlan('s1', 'missing'), []);
});

test('the store is bounded and says so instead of dropping silently', () => {
  const store = new CheckpointStore({ maxTurns: 2, maxChangesPerTurn: 3, maxTextBytes: 8 });
  for (let index = 0; index < 4; index += 1) {
    store.startTurn('s1', `turn ${index}`, index);
    store.record({ kind: 'create_text_file', path: 'a', beforeText: null, afterText: '1', reversible: true });
    // Over the per-change text budget, but still within the per-turn change budget.
    store.record({ kind: 'create_text_file', path: 'big', beforeText: null, afterText: 'x'.repeat(50), reversible: true });
    store.record({ kind: 'create_text_file', path: 'b', beforeText: null, afterText: '2', reversible: true });
    // These two are over the per-turn change budget.
    store.record({ kind: 'create_text_file', path: 'extra-1', beforeText: null, afterText: 'y', reversible: true });
    store.record({ kind: 'create_text_file', path: 'extra-2', beforeText: null, afterText: 'z', reversible: true });
    store.endTurn();
  }
  const turns = store.turns('s1');
  assert.equal(turns.length, 2, 'oldest turns are forgotten');
  assert.equal(turns[0].index, 3, 'the surviving turns are the newest ones');
  assert.equal(turns.at(-1).notReversible, 2, 'the oversized change and the turn-bound marker');

  const plan = store.rewindPlan('s1', undefined);
  const oversized = plan.find(change => change.path === 'big');
  assert.ok(oversized, 'an oversized change is still recorded');
  assert.equal(oversized.reversible, false, 'but it cannot be rewound');
  assert.match(oversized.reason, /too large/);
  assert.ok(plan.some(change => /checkpoint bound/.test(change.reason ?? '')), 'the bound is stated, not silent');
});

test('dropAfter forgets the reverted turn and everything after it', () => {
  const store = new CheckpointStore();
  for (const [index, label] of [[0, 'one'], [1, 'two'], [2, 'three']]) {
    store.startTurn('s1', label, index);
    store.record({ kind: 'create_text_file', path: label, beforeText: null, afterText: 'x', reversible: true });
    store.endTurn();
  }
  const [, two] = store.turns('s1');
  store.dropAfter('s1', two.id);
  assert.deepEqual(store.turns('s1').map(turn => turn.label), ['one']);

  store.clearSession('s1');
  assert.deepEqual(store.turns('s1'), []);
});

// --- rewind through the real edit service ----------------------------------

function harness(initialFiles = {}) {
  const memory = memoryWorkspace(initialFiles);
  const store = new CheckpointStore();
  const edits = new WorkspaceEditService(memory.write, undefined, memory.reads, undefined, '/w', store);
  return { memory, store, edits };
}

test('a checkpoint rewind restores files the agent changed', async () => {
  const { memory, store, edits } = harness({ 'a.txt': 'hello x world', 'gone.txt': 'delete me' });
  store.startTurn('s1', 'edit a', 0);
  await edits.replaceText(replacement('a.txt', 'hello x world', 'changed'), SIGNAL);
  await edits.deleteFile({ path: 'gone.txt' }, SIGNAL);
  await edits.createTextFile({ path: 'new.txt', content: 'brand new' }, SIGNAL);
  store.endTurn();

  const checkpoints = new CheckpointService(store, edits, { async forkSession() { throw new Error('unused'); } });
  const [turn] = store.turns('s1');
  const outcome = await checkpoints.rewind('s1', turn.id, SIGNAL);

  assert.equal(outcome.complete, true);
  assert.deepEqual(outcome.failed, []);
  assert.deepEqual([...memory.files.keys()].sort(), ['a.txt', 'gone.txt']);
  assert.equal(memory.files.get('a.txt'), 'hello x world');
  assert.equal(memory.files.get('gone.txt'), 'delete me');
  assert.deepEqual(store.turns('s1'), [], 'a complete rewind is forgotten');
});

test('a rewind reaches past the single-entry undo', async () => {
  const { memory, store, edits } = harness({ 'a.txt': 'x1' });
  store.startTurn('s1', 'turn one', 0);
  await edits.replaceText(replacement('a.txt', 'x1', 'x2'), SIGNAL);
  store.endTurn();
  store.startTurn('s1', 'turn two', 2);
  await edits.replaceText(replacement('a.txt', 'x2', 'x3'), SIGNAL);
  await edits.createTextFile({ path: 'b.txt', content: 'created later' }, SIGNAL);
  store.endTurn();

  const checkpoints = new CheckpointService(store, edits, {});
  const [, two] = store.turns('s1');
  // `undo_last_edit` reverts one journaled entry; a checkpoint reverts the whole
  // turn, whatever it touched.
  const outcome = await checkpoints.rewind('s1', two.id, SIGNAL);
  assert.equal(outcome.complete, true);
  assert.equal(memory.files.get('a.txt'), 'x2');
  assert.equal(memory.files.has('b.txt'), false);
  assert.deepEqual(store.turns('s1').map(turn => turn.label), ['turn one']);
});

test('a file edited since is refused, not clobbered', async () => {
  const { memory, store, edits } = harness({ 'a.txt': 'x1' });
  store.startTurn('s1', 'edit', 0);
  await edits.replaceText(replacement('a.txt', 'x1', 'x2'), SIGNAL);
  store.endTurn();
  // The user edits the file by hand after the agent's change.
  memory.files.set('a.txt', 'x2 plus my own edit');

  const checkpoints = new CheckpointService(store, edits, {});
  const [turn] = store.turns('s1');
  const outcome = await checkpoints.rewind('s1', turn.id, SIGNAL);

  assert.equal(outcome.complete, false);
  assert.equal(outcome.restored.length, 0);
  assert.match(outcome.failed[0].reason, /changed since it was read/);
  assert.equal(memory.files.get('a.txt'), 'x2 plus my own edit', 'user work is never overwritten');
  assert.equal(store.turns('s1').length, 1, 'a partial rewind keeps the checkpoint');
});

test('a change that was not retained is reported as not rewindable', async () => {
  const store = new CheckpointStore();
  store.startTurn('s1', 'mkdir', 0);
  store.record({
    kind: 'create_directory',
    path: 'd',
    beforeText: null,
    afterText: null,
    reversible: false,
    reason: 'Directory removal is not automated.'
  });
  store.endTurn();
  const edits = { async restoreFromCheckpoint(change) {
    return { path: change.path, restored: false, reason: change.reason };
  } };
  const checkpoints = new CheckpointService(store, edits, {});
  const outcome = await checkpoints.rewind('s1', store.turns('s1')[0].id, SIGNAL);
  assert.equal(outcome.complete, false);
  assert.match(outcome.failed[0].reason, /Directory removal/);
  assert.equal(store.turns('s1').length, 1);
});

test('a rename is reverted in the other direction', async () => {
  const { memory, store, edits } = harness({ 'old.txt': 'content' });
  store.startTurn('s1', 'rename', 0);
  await edits.renameFile({ fromPath: 'old.txt', toPath: 'new.txt' }, SIGNAL);
  store.endTurn();
  assert.deepEqual([...memory.files.keys()], ['new.txt']);

  const checkpoints = new CheckpointService(store, edits, {});
  await checkpoints.rewind('s1', store.turns('s1')[0].id, SIGNAL);
  assert.deepEqual([...memory.files.keys()], ['old.txt']);
  assert.equal(memory.files.get('old.txt'), 'content');
});

// --- fork ------------------------------------------------------------------

class MemoryRepository {
  async load() { return this.document && structuredClone(this.document); }
  async save(document) { this.document = structuredClone(document); }
}

async function sessionHarness() {
  const sessions = new SessionService(new MemoryRepository(), { now: () => 1, createId: () => `id-${Math.random()}` });
  await sessions.initialize('workspace', []);
  await sessions.setModelSelection({ providerId: 'p', modelId: 'm' });
  await sessions.setPermissionMode('acceptEdits');
  return sessions;
}

test('forking keeps the history before the chosen turn and switches to it', async () => {
  const sessions = await sessionHarness();
  await sessions.appendUserMessage('first request');
  await sessions.appendAssistantMessage('first answer', 'provider');
  await sessions.appendUserMessage('second request');
  await sessions.appendAssistantMessage('second answer', 'provider');
  await sessions.appendUserMessage('third request');

  const store = new CheckpointStore();
  // The second turn opened at item index 2 (after 'first request'/'first answer').
  store.startTurn(sessions.getActiveSession().id, 'second request', 2);
  store.endTurn();
  const turns = store.turns(sessions.getActiveSession().id);

  const checkpoints = new CheckpointService(store, {}, sessions);
  const forked = await checkpoints.fork(sessions.getActiveSession().id, turns[0].id);

  assert.ok(forked);
  assert.equal(forked.title, 'second request (fork)');
  assert.equal(forked.itemCount, 2, 'history stops before the forked request');
  const active = sessions.getActiveSession();
  assert.equal(active.id, forked.sessionId, 'the branch becomes the active session');
  assert.equal(active.permissionMode, 'acceptEdits', 'the mode carries over');
  assert.equal(active.model.modelId, 'm');
  assert.equal(active.titleSource, 'manual', 'a deliberate fork is never auto-renamed');
  assert.equal(sessions.listSessions().length, 2);
});

test('forking at the very first turn leaves an empty history', async () => {
  const sessions = await sessionHarness();
  await sessions.appendUserMessage('only request');
  const store = new CheckpointStore();
  store.startTurn(sessions.getActiveSession().id, 'only request', 0);
  store.endTurn();
  const checkpoints = new CheckpointService(store, {}, sessions);
  const forked = await checkpoints.fork(sessions.getActiveSession().id, store.turns(sessions.getActiveSession().id)[0].id);
  assert.equal(forked.itemCount, 0);
});

test('fork titles are bounded', () => {
  assert.equal(forkTitle('deploy the service'), 'deploy the service (fork)');
  assert.ok(forkTitle('x'.repeat(200)).length <= 70);
  assert.match(forkTitle('   '), /\(fork\)$/);
});

test('a fork for an unknown checkpoint is refused, not guessed', async () => {
  const sessions = await sessionHarness();
  const store = new CheckpointStore();
  const checkpoints = new CheckpointService(store, {}, sessions);
  assert.equal(await checkpoints.fork('missing-session', 'missing-turn'), undefined);
});

test('the composition root wires the command, the manifest declares it, and the chat marks turns', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /new CheckpointStore\(\)/);
  assert.match(source, /new CheckpointService\(checkpoints, agentWorkspace\.edits, sessions\)/);
  assert.match(source, /registerCommand\('yisiAI\.checkpoints'/);
  assert.match(source, /showCheckpoints\(checkpointService, sessions/);

  const chat = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'application', 'chat', 'chatService.ts'), 'utf8');
  assert.match(chat, /this\.checkpoints\?\.startTurn\(active\.id, text/);
  assert.match(chat, /this\.checkpoints\?\.endTurn\(\)/);

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(manifest.contributes.commands.some(command => command.command === 'yisiAI.checkpoints'));
});
