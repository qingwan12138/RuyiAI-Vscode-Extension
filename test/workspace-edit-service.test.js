const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WorkspaceEditInputError,
  WorkspaceEditService,
  createWorkspaceEditTool,
  createWorkspaceFileTool,
  createWorkspaceRewriteTool,
  createWorkspaceDeleteTool,
  createWorkspaceRenameTool,
  createWorkspaceDirectoryTool
} = require('../dist/yisi/application/edit/workspaceEditService');

function harness(diagnostics) {
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
    },
    async createTextFile(change, signal) {
      calls.push([change, signal]);
      return { path: change.path, sha256: 'c'.repeat(64), bytes: Buffer.byteLength(change.content) };
    },
    async rewriteTextFile(change, signal) {
      calls.push([change, signal]);
      return { path: change.path, beforeSha256: change.expectedSha256, afterSha256: 'd'.repeat(64), bytes: Buffer.byteLength(change.content) };
    },
    async deleteFile(change, signal) {
      calls.push([change, signal]);
      return { path: change.path, beforeSha256: 'e'.repeat(64), bytes: 4 };
    },
    async renameFile(change, signal) {
      calls.push([change, signal]);
      return { fromPath: change.fromPath, toPath: change.toPath };
    },
    async createDirectory(change, signal) {
      calls.push([change, signal]);
      return { path: change.path, created: true };
    }
  };
  const service = new WorkspaceEditService(port, diagnostics);
  return {
    calls,
    service,
    tool: createWorkspaceEditTool(service),
    createTool: createWorkspaceFileTool(service),
    rewriteTool: createWorkspaceRewriteTool(service),
    deleteTool: createWorkspaceDeleteTool(service),
    renameTool: createWorkspaceRenameTool(service),
    directoryTool: createWorkspaceDirectoryTool(service)
  };
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
  assert.equal(result.edit.replacements, 1);
  assert.equal(result.diagnostics.status, 'unavailable');
  assert.deepEqual(tool.inputSchema.required, ['path', 'expectedSha256', 'oldText', 'newText']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('declares and validates an exclusive text-file creation tool', async () => {
  const { calls, createTool } = harness();
  const signal = new AbortController().signal;
  const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal };

  const result = await createTool.execute({ path: 'src/new.ts', content: 'export {};\n' }, context);

  assert.equal(createTool.id, 'create_text_file');
  assert.equal(createTool.risk, 'workspaceWrite');
  assert.equal(createTool.mutatesWorkspace, true);
  assert.equal(result.edit.path, 'src/new.ts');
  assert.equal(result.diagnostics.status, 'unavailable');
  assert.deepEqual(calls, [[{ path: 'src/new.ts', content: 'export {};\n' }, signal]]);
  for (const invalid of [
    {}, { path: '', content: 'x' }, { path: 'a', content: 1 },
    { path: 'a', content: 'x', overwrite: true }, { path: 'a', content: 'x'.repeat(262_145) }
  ]) {
    await assert.rejects(createTool.execute(invalid, context), WorkspaceEditInputError);
  }
  assert.equal(calls.length, 1);
});

test('returns a bounded diagnostic snapshot after the edit without turning collection failure into edit failure', async () => {
  const snapshot = {
    available: true,
    items: [{ uri: 'file:///workspace/src/main.ts', severity: 'error', message: 'broken' }],
    total: 1,
    truncated: false,
    counts: { error: 1, warning: 0, information: 0, hint: 0 }
  };
  const signal = new AbortController().signal;
  const successful = harness({ read: async received => {
    assert.equal(received, signal);
    return snapshot;
  } });

  const result = await successful.tool.execute(valid, { sessionId: 's1', workspaceUri: 'file:///workspace', signal });
  assert.deepEqual(result.diagnostics, { status: 'snapshot', snapshot });
  assert.equal(successful.calls.length, 1);

  const failing = harness({ read: async () => { throw new Error('language server unavailable'); } });
  const failedEvidence = await failing.tool.execute(valid, { sessionId: 's1', workspaceUri: 'file:///workspace', signal });
  assert.equal(failedEvidence.edit.replacements, 1);
  assert.deepEqual(failedEvidence.diagnostics, { status: 'unavailable' });
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

test('rewrites whole files only when the agent created them in this run', async () => {
  const { calls, createTool, rewriteTool } = harness();
  const signal = new AbortController().signal;
  const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal };

  assert.equal(rewriteTool.id, 'rewrite_text_file');
  assert.equal(rewriteTool.risk, 'workspaceWrite');
  assert.equal(rewriteTool.mutatesWorkspace, true);

  // Not created by the agent -> rejected before the write port is touched.
  await assert.rejects(
    rewriteTool.execute({ path: 'src/user.ts', expectedSha256: 'a'.repeat(64), content: 'new' }, context),
    /only allowed for files created by the agent/i
  );
  assert.equal(calls.length, 0);

  // After an agent creation the same path may be rewritten whole.
  await createTool.execute({ path: 'src/generated_test.ts', content: 'v1' }, context);
  const result = await rewriteTool.execute(
    { path: 'src/generated_test.ts', expectedSha256: 'c'.repeat(64), content: 'v2' },
    context
  );
  assert.equal(result.edit.path, 'src/generated_test.ts');
  assert.equal(result.edit.afterSha256, 'd'.repeat(64));
  assert.equal(calls.length, 2);

  for (const invalid of [
    {}, { path: 'src/generated_test.ts', expectedSha256: 'bad', content: 'x' },
    { path: 'src/generated_test.ts', expectedSha256: 'a'.repeat(64), content: 'x'.repeat(262_145) },
    { path: 'src/generated_test.ts', expectedSha256: 'a'.repeat(64), content: 'x', extra: true }
  ]) {
    await assert.rejects(rewriteTool.execute(invalid, context), WorkspaceEditInputError);
  }
});

test('delete clears the agent-created ledger and rename remaps it', async () => {
  const { calls, createTool, rewriteTool, deleteTool, renameTool, directoryTool } = harness();
  const signal = new AbortController().signal;
  const context = { sessionId: 's1', workspaceUri: 'file:///workspace', signal };

  assert.equal(deleteTool.id, 'delete_file');
  assert.equal(renameTool.id, 'rename_file');
  assert.equal(directoryTool.id, 'create_directory');
  for (const tool of [deleteTool, renameTool, directoryTool]) {
    assert.equal(tool.risk, 'workspaceWrite');
    assert.equal(tool.mutatesWorkspace, true);
  }

  await createTool.execute({ path: 'tmp/keep.ts', content: 'x' }, context);
  await renameTool.execute({ fromPath: 'tmp/keep.ts', toPath: 'tmp/kept.ts' }, context);
  // Rewrite of the new path is allowed (ledger followed the rename)...
  await rewriteTool.execute({ path: 'tmp/kept.ts', expectedSha256: 'c'.repeat(64), content: 'y' }, context);
  // ...but the old path is gone from the ledger.
  await assert.rejects(
    rewriteTool.execute({ path: 'tmp/keep.ts', expectedSha256: 'c'.repeat(64), content: 'z' }, context),
    /only allowed for files created by the agent/i
  );

  await createTool.execute({ path: 'tmp/gone.ts', content: 'x' }, context);
  await deleteTool.execute({ path: 'tmp/gone.ts' }, context);
  await assert.rejects(
    rewriteTool.execute({ path: 'tmp/gone.ts', expectedSha256: 'c'.repeat(64), content: 'z' }, context),
    /only allowed for files created by the agent/i
  );

  await directoryTool.execute({ path: 'tmp/nested' }, context);
  assert.equal(calls.length, 6);

  for (const invalid of [
    { path: '' }, { path: 'a', extra: true },
    { fromPath: '' }, { toPath: '' }, { fromPath: 'a', extra: true }
  ]) {
    await assert.rejects(deleteTool.execute(invalid, context), WorkspaceEditInputError);
    await assert.rejects(renameTool.execute(invalid, context), WorkspaceEditInputError);
    await assert.rejects(directoryTool.execute(invalid, context), WorkspaceEditInputError);
  }
});
