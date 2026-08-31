const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentToolLoop, ReadOnlyAgentLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

function tool(id = 'read_file', execute = async input => ({ path: input.path, text: 'content' })) {
  return {
    id,
    description: `Tool ${id}`,
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    execute
  };
}

function provider(rounds, requests = []) {
  return {
    async *streamAgent(request, signal) {
      requests.push({ request: structuredClone(request), signal });
      const events = rounds.shift();
      if (!events) throw new Error('unexpected provider round');
      for (const event of events) yield event;
    }
  };
}

const call = (id, name, input) => ({ type: 'toolCall', call: { id, name, input } });
const text = value => ({ type: 'textDelta', text: value });
const context = signal => ({ sessionId: 'session-1', workspaceUri: 'file:///workspace', signal });
const request = { model: 'model', messages: [{ role: 'user', content: 'inspect the project' }] };

test('executes a read-only tool, returns its structural result, then streams final text', async () => {
  const requests = [];
  const executed = [];
  const registry = new ToolRegistry([tool('read_file', async (input, execution) => {
    executed.push({ input, execution });
    return { path: input.path, text: 'export const value = 1;' };
  })]);
  const loop = new ReadOnlyAgentLoop(
    provider([[call('call-1', 'read_file', { path: 'src/a.ts' })], [text('final '), text('answer')]], requests),
    registry,
    new PermissionEngine()
  );
  const deltas = [];
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'manual', delta => deltas.push(delta), signal);

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'final answer');
  assert.deepEqual(deltas, ['final ', 'answer']);
  assert.deepEqual(executed[0].input, { path: 'src/a.ts' });
  assert.equal(executed[0].execution.signal, signal);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].request.messages.slice(-2), [
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'src/a.ts' } }] },
    {
      role: 'tool', toolCallId: 'call-1', name: 'read_file',
      content: JSON.stringify({ ok: true, result: { path: 'src/a.ts', text: 'export const value = 1;' }, truncated: false })
    }
  ]);
  assert.equal(result.executions[0].outcome, 'succeeded');
});

test('executes multiple calls sequentially and permission-checks every call', async () => {
  const order = [];
  const decisions = [];
  const permission = {
    evaluate: (mode, metadata) => {
      decisions.push([mode, metadata]);
      return { outcome: 'allow', allowed: true, needsConfirmation: false, reason: 'test allow' };
    }
  };
  const registry = new ToolRegistry([
    tool('read_file', async () => { order.push('read'); return { text: 'x' }; }),
    tool('list_directory', async () => { order.push('list'); return []; })
  ]);
  const loop = new ReadOnlyAgentLoop(provider([[
    call('c1', 'read_file', { path: 'a' }),
    call('c2', 'list_directory', { path: '.' })
  ], [text('done')]]), registry, permission);

  const result = await loop.run(request, context(new AbortController().signal), 'plan', () => {}, new AbortController().signal);

  assert.equal(result.status, 'completed');
  assert.deepEqual(order, ['read', 'list']);
  assert.equal(decisions.length, 2);
});

test('blocks unknown tools and permission confirmation without executing', async () => {
  const registry = new ToolRegistry([tool()]);
  const unknown = new ReadOnlyAgentLoop(
    provider([[call('c1', 'delete_file', { path: 'a' })]]), registry, new PermissionEngine()
  );
  const signal = new AbortController().signal;
  const unknownResult = await unknown.run(request, context(signal), 'manual', () => {}, signal);
  assert.equal(unknownResult.status, 'blocked');
  assert.match(unknownResult.reason, /Unknown tool/);

  let executed = false;
  const confirming = new ReadOnlyAgentLoop(
    provider([[call('c1', 'read_file', { path: 'a' })]]),
    new ToolRegistry([tool('read_file', async () => { executed = true; })]),
    { evaluate: () => ({ outcome: 'confirm', allowed: true, needsConfirmation: true, reason: 'approval required' }) }
  );
  const confirmResult = await confirming.run(request, context(signal), 'manual', () => {}, signal);
  assert.equal(confirmResult.status, 'blocked');
  assert.match(confirmResult.reason, /approval required/);
  assert.equal(executed, false);
});

test('executes a confirmed workspace edit and fails closed when approval is rejected', async () => {
  const approvals = [];
  const executions = [];
  const edit = tool('replace_text', async input => { executions.push(input); return { replacements: 1 }; });
  edit.risk = 'workspaceWrite';
  edit.mutatesWorkspace = true;
  const signal = new AbortController().signal;
  const editCall = call('edit-1', 'replace_text', { path: 'src/a.ts' });
  const accepted = new AgentToolLoop(
    provider([[editCall], [text('edited')]]),
    new ToolRegistry([edit]),
    new PermissionEngine(),
    {},
    { confirm: async (request, receivedSignal) => { approvals.push([request, receivedSignal]); return true; } }
  );

  const acceptedResult = await accepted.run(request, context(signal), 'manual', () => {}, signal);
  assert.equal(acceptedResult.status, 'completed');
  assert.equal(executions.length, 1);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0][0].toolId, 'replace_text');
  assert.equal(approvals[0][1], signal);

  const rejected = new AgentToolLoop(
    provider([[editCall]]),
    new ToolRegistry([edit]),
    new PermissionEngine(),
    {},
    { confirm: async () => false }
  );
  const rejectedResult = await rejected.run(request, context(signal), 'manual', () => {}, signal);
  assert.equal(rejectedResult.status, 'blocked');
  assert.match(rejectedResult.reason, /declined/i);
  assert.equal(executions.length, 1);
});

test('fails closed when a non-read-only tool is accidentally registered', async () => {
  let executed = false;
  const unsafe = tool('run_command', async () => { executed = true; });
  unsafe.risk = 'processExec';
  const loop = new ReadOnlyAgentLoop(
    provider([[call('c1', 'run_command', { path: 'ignored' })]]),
    new ToolRegistry([unsafe]),
    { evaluate: () => ({ outcome: 'allow', allowed: true, needsConfirmation: false, reason: 'incorrect allow' }) }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'fullAccess', () => {}, signal);

  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /Agent tool scope/i);
  assert.equal(executed, false);
});

test('returns bounded tool failures to the provider so it can recover', async () => {
  const requests = [];
  const loop = new ReadOnlyAgentLoop(
    provider([[call('c1', 'read_file', { path: '' })], [text('recovered')]], requests),
    new ToolRegistry([tool('read_file', async () => { throw new Error('bad input ' + 'x'.repeat(1_000)); })]),
    new PermissionEngine(),
    { maxErrorCharacters: 40 }
  );
  const signal = new AbortController().signal;
  const result = await loop.run(request, context(signal), 'manual', () => {}, signal);

  assert.equal(result.status, 'completed');
  assert.equal(result.executions[0].outcome, 'failed');
  const toolMessage = requests[1].request.messages.at(-1);
  assert.ok(toolMessage.content.length < 100);
  assert.match(toolMessage.content, /bad input/);
});

test('truncates large tool results using a valid JSON envelope', async () => {
  const requests = [];
  const loop = new ReadOnlyAgentLoop(
    provider([[call('c1', 'read_file', { path: 'a' })], [text('done')]], requests),
    new ToolRegistry([tool('read_file', async () => ({ text: 'z'.repeat(2_000) }))]),
    new PermissionEngine(),
    { maxResultCharacters: 180 }
  );
  const signal = new AbortController().signal;
  const result = await loop.run(request, context(signal), 'manual', () => {}, signal);
  const envelope = JSON.parse(requests[1].request.messages.at(-1).content);

  assert.equal(envelope.ok, true);
  assert.equal(envelope.truncated, true);
  assert.ok(requests[1].request.messages.at(-1).content.length <= 180);
  assert.equal(result.executions[0].truncated, true);
});

test('blocks repeated calls, mixed text/tool rounds, empty output, and exhausted rounds', async () => {
  const signal = new AbortController().signal;
  const registry = new ToolRegistry([tool()]);
  const repeated = new ReadOnlyAgentLoop(provider([
    [call('c1', 'read_file', { path: 'a' })],
    [call('c2', 'read_file', { path: 'a' })]
  ]), registry, new PermissionEngine());
  assert.match((await repeated.run(request, context(signal), 'manual', () => {}, signal)).reason, /Repeated tool call/);

  const mixed = new ReadOnlyAgentLoop(provider([[text('maybe'), call('c1', 'read_file', { path: 'a' })]]), registry, new PermissionEngine());
  assert.match((await mixed.run(request, context(signal), 'manual', () => {}, signal)).reason, /mixed text and tool/i);

  const empty = new ReadOnlyAgentLoop(provider([[]]), registry, new PermissionEngine());
  assert.match((await empty.run(request, context(signal), 'manual', () => {}, signal)).reason, /empty/i);

  const budget = new ReadOnlyAgentLoop(provider([
    [call('c1', 'read_file', { path: 'a' })],
    [call('c2', 'read_file', { path: 'b' })]
  ]), registry, new PermissionEngine(), { maxRounds: 2 });
  assert.match((await budget.run(request, context(signal), 'manual', () => {}, signal)).reason, /round budget/i);
});

test('forwards cancellation without converting it into a successful result', async () => {
  const controller = new AbortController();
  const cancellingProvider = {
    async *streamAgent(_request, signal) {
      controller.abort();
      signal.throwIfAborted();
      yield text('never');
    }
  };
  const loop = new ReadOnlyAgentLoop(cancellingProvider, new ToolRegistry([tool()]), new PermissionEngine());
  await assert.rejects(
    loop.run(request, context(controller.signal), 'manual', () => {}, controller.signal),
    error => error && error.name === 'AbortError'
  );
});

test('reports a completed workspace mutation when cancellation arrives after the write', async () => {
  const controller = new AbortController();
  const edit = tool('replace_text', async () => {
    controller.abort();
    return { path: 'src/a.ts', replacements: 1 };
  });
  edit.risk = 'workspaceWrite';
  edit.mutatesWorkspace = true;
  const loop = new AgentToolLoop(
    provider([[call('edit-1', 'replace_text', { path: 'src/a.ts' })]]),
    new ToolRegistry([edit]),
    new PermissionEngine()
  );

  const result = await loop.run(request, context(controller.signal), 'acceptEdits', () => {}, controller.signal);

  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /change was applied/i);
  assert.deepEqual(result.executions, [{
    callId: 'edit-1', toolId: 'replace_text', outcome: 'succeeded', truncated: false
  }]);
});

test('tool registry rejects duplicate ids and returns cloned definitions', () => {
  assert.throws(() => new ToolRegistry([tool(), tool()]), /Duplicate tool id/);
  const registry = new ToolRegistry([tool()]);
  const definitions = registry.definitions();
  definitions[0].parameters.changed = true;
  assert.equal(registry.definitions()[0].parameters.changed, undefined);
});
