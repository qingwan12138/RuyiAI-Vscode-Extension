const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WorkspaceContextInputError,
  WorkspaceContextService,
  createWorkspaceContextTools
} = require('../dist/yisi/application/context/workspaceContextService');

function harness() {
  const calls = [];
  const port = {
    async readFile(path, signal) {
      calls.push(['read', path, signal]);
      return { path, text: 'content', bytes: 7 };
    },
    async listDirectory(path, signal) {
      calls.push(['list', path, signal]);
      return [{ path: `${path}/file.ts`, name: 'file.ts', kind: 'file' }];
    },
    async searchText(query, scope, signal) {
      calls.push(['search', query, scope, signal]);
      return { matches: [], scannedFiles: 1, truncated: false };
    }
  };
  const service = new WorkspaceContextService(port);
  const tools = createWorkspaceContextTools(service);
  return { calls, service, tools };
}

test('declares conservative read-only tool metadata', () => {
  const { tools } = harness();

  assert.deepEqual(tools.map(tool => ({
    id: tool.id,
    risk: tool.risk,
    mutatesWorkspace: tool.mutatesWorkspace,
    supportsCancellation: tool.supportsCancellation,
    hasDescription: tool.description.length > 0
  })), [
    { id: 'read_file', risk: 'readOnly', mutatesWorkspace: false, supportsCancellation: true, hasDescription: true },
    { id: 'list_directory', risk: 'readOnly', mutatesWorkspace: false, supportsCancellation: true, hasDescription: true },
    { id: 'search_text', risk: 'readOnly', mutatesWorkspace: false, supportsCancellation: true, hasDescription: true }
  ]);
});

test('validates exact tool inputs and forwards the execution AbortSignal', async () => {
  const { calls, tools } = harness();
  const signal = new AbortController().signal;
  const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal };

  await tools[0].execute({ path: 'src/main.ts' }, context);
  await tools[1].execute({ path: '.' }, context);
  await tools[2].execute({ query: 'needle', scope: 'src' }, context);

  assert.deepEqual(calls, [
    ['read', 'src/main.ts', signal],
    ['list', '.', signal],
    ['search', 'needle', 'src', signal]
  ]);

  for (const invalid of [
    [{}, 0],
    [{ path: '   ' }, 0],
    [{ path: 'x', unexpected: true }, 0],
    [{ query: '' }, 2],
    [{ query: 'x', scope: 42 }, 2]
  ]) {
    await assert.rejects(tools[invalid[1]].execute(invalid[0], context), WorkspaceContextInputError);
  }
});

test('uses the workspace root as the default search scope and preserves bounded results', async () => {
  const { calls, service } = harness();
  const signal = new AbortController().signal;

  const result = await service.searchText({ query: ' needle ' }, signal);

  assert.deepEqual(result, { matches: [], scannedFiles: 1, truncated: false });
  assert.deepEqual(calls[0], ['search', 'needle', '.', signal]);
});
