const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WorkspaceEditInputError,
  WorkspaceEditService,
  createWorkspaceEditTool
} = require('../dist/yisi/application/edit/workspaceEditService');

function harness() {
  const calls = [];
  const port = {
    async replaceText(change, signal) {
      calls.push([change, signal]);
      return {
        path: change.path,
        beforeSha256: change.expectedSha256,
        afterSha256: 'b'.repeat(64),
        replacements: 1,
        bytes: 12
      };
    }
  };
  const service = new WorkspaceEditService(port);
  return { calls, service, tool: createWorkspaceEditTool(service) };
}

const valid = {
  path: 'src/main.ts',
  expectedSha256: 'a'.repeat(64),
  oldText: 'const before = 1;',
  newText: 'const after = 2;'
};

test('declares one bounded workspace-write tool and forwards the execution signal', async () => {
  const { calls, tool } = harness();
  const signal = new AbortController().signal;

  const result = await tool.execute(valid, { sessionId: 's1', workspaceUri: 'file:///workspace', signal });

  assert.equal(tool.id, 'replace_text');
  assert.equal(tool.risk, 'workspaceWrite');
  assert.equal(tool.mutatesWorkspace, true);
  assert.equal(tool.supportsCancellation, true);
  assert.deepEqual(calls, [[valid, signal]]);
  assert.equal(result.replacements, 1);
  assert.deepEqual(tool.inputSchema.required, ['path', 'expectedSha256', 'oldText', 'newText']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('rejects malformed or oversized edit inputs before reaching the write port', async () => {
  const { calls, tool } = harness();
  const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal: new AbortController().signal };
  const invalid = [
    {},
    { ...valid, path: '   ' },
    { ...valid, expectedSha256: 'not-a-hash' },
    { ...valid, oldText: '' },
    { ...valid, newText: 'x'.repeat(65_537) },
    { ...valid, unexpected: true }
  ];

  for (const input of invalid) {
    await assert.rejects(tool.execute(input, context), WorkspaceEditInputError);
  }
  assert.equal(calls.length, 0);
});
