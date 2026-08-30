const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  JsonSessionRepository,
  SessionPersistenceError
} = require('../dist/yisi/infrastructure/persistence/jsonSessionRepository');

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'yisi-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function documentWithWorkspace(workspaceId) {
  return {
    schemaVersion: 1,
    workspaces: {
      [workspaceId]: { sessions: [] }
    }
  };
}

test('loads undefined when the session file does not exist', async t => {
  const repository = new JsonSessionRepository(await temporaryDirectory(t));
  assert.equal(await repository.load(), undefined);
});

test('round trips a versioned session document', async t => {
  const repository = new JsonSessionRepository(await temporaryDirectory(t));
  const document = documentWithWorkspace('workspace-a');

  await repository.save(document);

  assert.deepEqual(await repository.load(), document);
});

test('does not overwrite a corrupt session file while loading', async t => {
  const directory = await temporaryDirectory(t);
  const target = join(directory, 'sessions-v1.json');
  await writeFile(target, '{broken-json', 'utf8');
  const repository = new JsonSessionRepository(directory);

  await assert.rejects(
    () => repository.load(),
    error => error instanceof SessionPersistenceError && /read persisted sessions/.test(error.message)
  );
  assert.equal(await readFile(target, 'utf8'), '{broken-json');
});

test('serializes concurrent saves in call order', async t => {
  const repository = new JsonSessionRepository(await temporaryDirectory(t));

  await Promise.all([
    repository.save(documentWithWorkspace('workspace-a')),
    repository.save(documentWithWorkspace('workspace-b')),
    repository.save(documentWithWorkspace('workspace-c'))
  ]);

  assert.deepEqual(await repository.load(), documentWithWorkspace('workspace-c'));
});
