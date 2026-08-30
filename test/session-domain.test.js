const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SessionSchemaError,
  parseSessionDocument
} = require('../dist/yisi/domain/session');

function validSession() {
  return {
    id: 'session-1',
    workspaceId: 'workspace-1',
    title: 'New Chat',
    titleSource: 'fallback',
    model: { providerId: '', modelId: '' },
    permissionMode: 'plan',
    executionWorkspace: { kind: 'current', uri: 'workspace-1' },
    createdAt: 10,
    updatedAt: 10,
    status: 'idle',
    items: [
      { id: 'item-1', type: 'userMessage', text: 'Hello', createdAt: 11 },
      { id: 'item-2', type: 'assistantMessage', text: 'Not connected', source: 'baseline', createdAt: 12 }
    ]
  };
}

test('parseSessionDocument accepts and clones a version 1 document', () => {
  const input = {
    schemaVersion: 1,
    workspaces: {
      'workspace-1': { activeSessionId: 'session-1', sessions: [validSession()] }
    }
  };

  const parsed = parseSessionDocument(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.workspaces['workspace-1'].sessions, input.workspaces['workspace-1'].sessions);
});

test('parseSessionDocument rejects future schema versions', () => {
  assert.throws(
    () => parseSessionDocument({ schemaVersion: 2, workspaces: {} }),
    error => error instanceof SessionSchemaError && /Unsupported session schema/.test(error.message)
  );
});

test('parseSessionDocument rejects malformed conversation items', () => {
  const session = validSession();
  session.items[0] = { id: 'item-1', type: 'userMessage', text: 42, createdAt: 11 };

  assert.throws(
    () => parseSessionDocument({
      schemaVersion: 1,
      workspaces: { 'workspace-1': { activeSessionId: 'session-1', sessions: [session] } }
    }),
    error => error instanceof SessionSchemaError && /Malformed session document/.test(error.message)
  );
});

test('accepts file context references but rejects persisted raw attachment content', () => {
  const session = validSession();
  session.items[0].contexts = [{ type: 'file', path: 'src/main.ts', workspaceFolderUri: 'file:///workspace' }];
  const document = {
    schemaVersion: 1,
    workspaces: { 'workspace-1': { activeSessionId: 'session-1', sessions: [session] } }
  };

  assert.deepEqual(parseSessionDocument(document), document);
  session.items[0].contexts[0].content = 'must not persist';
  assert.throws(() => parseSessionDocument(document), SessionSchemaError);
});

test('parseSessionDocument rejects an active session outside its workspace bucket', () => {
  assert.throws(
    () => parseSessionDocument({
      schemaVersion: 1,
      workspaces: { 'workspace-1': { activeSessionId: 'missing', sessions: [validSession()] } }
    }),
    error => error instanceof SessionSchemaError && /active session/.test(error.message)
  );
});
