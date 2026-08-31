const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SessionInputError,
  SessionNotFoundError,
  SessionService
} = require('../dist/yisi/application/session/sessionService');

class MemoryRepository {
  constructor(document) {
    this.document = document;
    this.failSave = false;
  }

  async load() {
    return this.document === undefined ? undefined : structuredClone(this.document);
  }

  async save(document) {
    if (this.failSave) throw new Error('save failed');
    this.document = structuredClone(document);
  }
}

function createHarness(existingDocument) {
  const repository = new MemoryRepository(existingDocument);
  let timestamp = 100;
  let sequence = 0;
  const service = new SessionService(repository, {
    now: () => ++timestamp,
    createId: () => `id-${++sequence}`
  });
  return { repository, service };
}

test('initializes an empty workspace with an active Plan session', async () => {
  const { service } = createHarness();

  const result = await service.initialize('workspace-a', []);

  assert.deepEqual(result, { importedLegacy: false });
  assert.equal(service.listSessions().length, 1);
  assert.equal(service.getActiveSession().title, 'New Chat');
  assert.equal(service.getActiveSession().permissionMode, 'plan');
});

test('lists newest sessions first and switches the active session', async () => {
  const { service } = createHarness();
  await service.initialize('workspace-a', []);
  const first = service.getActiveSession();
  const second = await service.createSession();

  assert.deepEqual(service.listSessions().map(item => item.id), [second.id, first.id]);
  await service.switchSession(first.id);
  assert.equal(service.getActiveSession().id, first.id);
  assert.equal(service.listSessions().find(item => item.id === first.id).active, true);
});

test('renames a session with trimmed text and marks the title manual', async () => {
  const { service } = createHarness();
  await service.initialize('workspace-a', []);
  const session = service.getActiveSession();

  await service.renameSession(session.id, '  Build investigation  ');

  assert.equal(service.getActiveSession().title, 'Build investigation');
  assert.equal(service.getActiveSession().titleSource, 'manual');
  await assert.rejects(() => service.renameSession(session.id, '   '), SessionInputError);
});

test('persists only known permission modes for the active session', async () => {
  const { service } = createHarness();
  await service.initialize('workspace-a', []);

  await service.setPermissionMode('manual');
  assert.equal(service.getActiveSession().permissionMode, 'manual');
  await assert.rejects(() => service.setPermissionMode('unrestricted'), SessionInputError);
  assert.equal(service.getActiveSession().permissionMode, 'manual');
});

test('rejects unknown session ids without changing active state', async () => {
  const { service } = createHarness();
  await service.initialize('workspace-a', []);
  const activeId = service.getActiveSession().id;

  await assert.rejects(() => service.switchSession('missing'), SessionNotFoundError);

  assert.equal(service.getActiveSession().id, activeId);
});

test('deleting the final session creates and activates a blank replacement', async () => {
  const { service } = createHarness();
  await service.initialize('workspace-a', []);
  const original = service.getActiveSession();

  await service.deleteSession(original.id);

  assert.notEqual(service.getActiveSession().id, original.id);
  assert.equal(service.listSessions().length, 1);
  assert.equal(service.getActiveSession().items.length, 0);
});

test('persists ordered messages and restores them in a new service', async () => {
  const { repository, service } = createHarness();
  await service.initialize('workspace-a', []);

  await service.appendUserMessage('  Hello Yisi  ');
  await service.appendAssistantMessage('Provider is not connected.', 'baseline');

  const restored = new SessionService(repository, {
    now: () => 500,
    createId: () => 'unused'
  });
  await restored.initialize('workspace-a', []);
  assert.deepEqual(
    restored.getActiveSession().items.map(item => [item.type, item.text]),
    [
      ['userMessage', 'Hello Yisi'],
      ['assistantMessage', 'Provider is not connected.']
    ]
  );
});

test('keeps in-memory state unchanged when persistence fails', async () => {
  const { repository, service } = createHarness();
  await service.initialize('workspace-a', []);
  const before = service.getActiveSession();
  repository.failSave = true;

  await assert.rejects(() => service.renameSession(before.id, 'Changed'), /save failed/);

  assert.deepEqual(service.getActiveSession(), before);
});

test('imports compatible legacy metadata once', async () => {
  const { service } = createHarness();
  const legacy = [{
    id: 'legacy-1',
    title: 'Legacy session',
    workspaceId: 'workspace-a',
    model: { providerId: 'local', modelId: 'model-a' },
    permissionMode: 'manual',
    createdAt: 10,
    updatedAt: 20,
    userRenamed: true,
    status: 'idle'
  }];

  const result = await service.initialize('workspace-a', legacy);

  assert.deepEqual(result, { importedLegacy: true });
  assert.equal(service.getActiveSession().id, 'legacy-1');
  assert.equal(service.getActiveSession().titleSource, 'manual');
  assert.deepEqual(service.getActiveSession().items, []);
});
