const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSessionDocument, SessionSchemaError } = require('../dist/yisi/domain/session');

const validSession = {
  id: 's1',
  workspaceId: 'ws',
  title: 'New Chat',
  titleSource: 'fallback',
  model: { providerId: 'provider', modelId: 'model' },
  permissionMode: 'manual',
  executionWorkspace: { kind: 'current', uri: 'file:///ws' },
  createdAt: 1000,
  updatedAt: 2000,
  status: 'idle',
  items: [{ id: 'u1', type: 'userMessage', text: 'hello', createdAt: 1001, contexts: [] }]
};

test('accepts a valid v1 session document and round-trips it', () => {
  const doc = parseSessionDocument({
    schemaVersion: 1,
    workspaces: { ws: { activeSessionId: 's1', sessions: [validSession] } }
  });
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.workspaces.ws.sessions[0].id, 's1');
  assert.equal(doc.workspaces.ws.activeSessionId, 's1');
});

test('rejects a future or unknown schema version (migration guard)', () => {
  assert.throws(
    () => parseSessionDocument({ schemaVersion: 2, workspaces: {} }),
    error => error instanceof SessionSchemaError && /Unsupported session schema/.test(error.message)
  );
});

test('rejects malformed document shapes and active-session mismatches', () => {
  assert.throws(() => parseSessionDocument({ schemaVersion: 1, workspaces: 'x' }));
  assert.throws(
    () => parseSessionDocument({ schemaVersion: 1, workspaces: { ws: { activeSessionId: 'missing', sessions: [validSession] } } }),
    /active session/
  );
  assert.throws(() => parseSessionDocument({ schemaVersion: 1, workspaces: { ws: { sessions: [{ id: 'bad' }] } } }));
});

test('accepts an empty document', () => {
  assert.deepEqual(parseSessionDocument({ schemaVersion: 1, workspaces: {} }), { schemaVersion: 1, workspaces: {} });
});
