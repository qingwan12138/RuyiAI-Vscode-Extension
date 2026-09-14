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

test('blocks unknown tools, and answers a missing approval channel with a denial', async () => {
  const registry = new ToolRegistry([tool()]);
  const unknown = new ReadOnlyAgentLoop(
    provider([[call('c1', 'delete_file', { path: 'a' })]]), registry, new PermissionEngine()
  );
  const signal = new AbortController().signal;
  const unknownResult = await unknown.run(request, context(signal), 'manual', () => {}, signal);
  // An unknown tool is a protocol violation, not a user decision, so it still
  // stops the run.
  assert.equal(unknownResult.status, 'blocked');
  assert.match(unknownResult.reason, /Unknown tool/);

  // A confirmation the host cannot ask for is a different matter: the action fails
  // closed, and the model is told which kind of refusal it was instead of losing
  // the whole run.
  let executed = false;
  const requests = [];
  const confirming = new ReadOnlyAgentLoop(
    provider([[call('c1', 'read_file', { path: 'a' })], [text('understood')]], requests),
    new ToolRegistry([tool('read_file', async () => { executed = true; })]),
    { evaluate: () => ({ outcome: 'confirm', allowed: true, needsConfirmation: true, reason: 'approval required' }) }
  );
  const confirmResult = await confirming.run(request, context(signal), 'manual', () => {}, signal);
  assert.equal(confirmResult.status, 'completed');
  assert.equal(confirmResult.finalText, 'understood');
  assert.equal(executed, false, 'a confirmation that cannot be asked never executes');
  const denial = JSON.parse(requests[1].request.messages.at(-1).content);
  assert.equal(denial.denied, true);
  assert.equal(denial.reason, 'unavailable', 'distinguishable from a policy or user refusal');
  assert.match(denial.error, /approval required/);
  assert.match(denial.guidance, /Do not retry/);
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

  // A user "no" is an outcome the model can act on, not the end of the run.
  const declinedRuns = [];
  const rejectedRequests = [];
  const declinedTool = tool('replace_text', async () => { declinedRuns.push(1); return { replacements: 1 }; });
  declinedTool.risk = 'workspaceWrite';
  declinedTool.mutatesWorkspace = true;
  const rejected = new AgentToolLoop(
    provider([[editCall], [text('understood — I will not touch that file')]], rejectedRequests),
    new ToolRegistry([declinedTool]),
    new PermissionEngine(),
    {},
    { confirm: async () => false }
  );
  const rejectedResult = await rejected.run(request, context(signal), 'manual', () => {}, signal);
  assert.equal(rejectedResult.status, 'completed');
  assert.equal(rejectedResult.finalText, 'understood — I will not touch that file');
  assert.equal(declinedRuns.length, 0, 'the declined edit never ran');
  assert.deepEqual(rejectedResult.executions.map(item => item.outcome), ['failed']);
  const denial = JSON.parse(rejectedRequests[1].request.messages.at(-1).content);
  assert.equal(denial.denied, true);
  assert.equal(denial.reason, 'user');
  assert.match(denial.guidance, /Do not repeat it/);
});

test('admits permission-gated process-exec tools but still fails closed out of scope', async () => {
  // processExec is admitted and executed when the permission engine allows it
  // (session full access), without any confirmation port.
  let executed = false;
  const runTool = tool('run_command', async input => { executed = true; return { status: 'exited', exitCode: 0 }; });
  runTool.risk = 'processExec';
  runTool.mutatesWorkspace = true;
  const admitted = new ReadOnlyAgentLoop(
    provider([[call('c1', 'run_command', { executable: 'ctest' })], [text('tests ok')]]),
    new ToolRegistry([runTool]),
    new PermissionEngine()
  );
  const signal = new AbortController().signal;
  const admittedResult = await admitted.run(request, context(signal), 'fullAccess', () => {}, signal);
  assert.equal(admittedResult.status, 'completed');
  assert.equal(admittedResult.finalText, 'tests ok');
  assert.equal(executed, true);

  // Out-of-scope risks (destructive / network) never reach execute.
  for (const risk of ['destructive', 'network']) {
    let touched = false;
    const unsafe = tool('run_command', async () => { touched = true; });
    unsafe.risk = risk;
    unsafe.mutatesWorkspace = true;
    const loop = new ReadOnlyAgentLoop(
      provider([[call('c1', 'run_command', { executable: 'ctest' })]]),
      new ToolRegistry([unsafe]),
      { evaluate: () => ({ outcome: 'allow', allowed: true, needsConfirmation: false, reason: 'incorrect allow' }) }
    );
    const result = await loop.run(request, context(signal), 'fullAccess', () => {}, signal);
    assert.equal(result.status, 'blocked', `${risk} must stay out of the bounded scope`);
    assert.match(result.reason, /Agent tool scope/i);
    assert.equal(touched, false);
  }

  // environmentChange is admitted like processExec (permission-gated below).
  let envTouched = false;
  const envTool = tool('ruyi_manage', async () => { envTouched = true; return { code: 0, records: [] }; });
  envTool.risk = 'environmentChange';
  envTool.mutatesWorkspace = true;
  const envLoop = new ReadOnlyAgentLoop(
    provider([[call('c1', 'ruyi_manage', { action: 'install', packageId: 'gcc' })], [text('done')]]),
    new ToolRegistry([envTool]),
    new PermissionEngine()
  );
  const envResult = await envLoop.run(request, context(signal), 'fullAccess', () => {}, signal);
  assert.equal(envResult.status, 'completed');
  assert.equal(envTouched, true);
});

test('keeps process-exec commands behind explicit confirmation in manual mode', async () => {
  let executed = false;
  const runTool = tool('run_command', async () => { executed = true; return { status: 'exited', exitCode: 0 }; });
  runTool.risk = 'processExec';
  runTool.mutatesWorkspace = true;
  const approvals = [];
  const requests = [];
  const declined = new ReadOnlyAgentLoop(
    provider([[call('c1', 'run_command', { executable: 'ctest' })], [text('noted')]], requests),
    new ToolRegistry([runTool]),
    new PermissionEngine(),
    {},
    { confirm: async request => { approvals.push(request); return false; } }
  );
  const signal = new AbortController().signal;
  const result = await declined.run(request, context(signal), 'manual', () => {}, signal);
  // Declining one command must not abort the conversation: the model is told the
  // user said no and keeps working.
  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'noted');
  assert.equal(executed, false);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].toolId, 'run_command');
  assert.equal(JSON.parse(requests[1].request.messages.at(-1).content).reason, 'user');
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

test('blocks repeated calls, empty output, and exhausted rounds', async () => {
  const signal = new AbortController().signal;
  const registry = new ToolRegistry([tool()]);
  const repeated = new ReadOnlyAgentLoop(provider([
    [call('c1', 'read_file', { path: 'a' })],
    [call('c2', 'read_file', { path: 'a' })]
  ]), registry, new PermissionEngine());
  assert.match((await repeated.run(request, context(signal), 'manual', () => {}, signal)).reason, /Repeated tool call/);

  const empty = new ReadOnlyAgentLoop(provider([[]]), registry, new PermissionEngine());
  assert.match((await empty.run(request, context(signal), 'manual', () => {}, signal)).reason, /empty/i);

  const budget = new ReadOnlyAgentLoop(provider([
    [call('c1', 'read_file', { path: 'a' })],
    [call('c2', 'read_file', { path: 'b' })]
  ]), registry, new PermissionEngine(), { maxRounds: 2 });
  assert.match((await budget.run(request, context(signal), 'manual', () => {}, signal)).reason, /round budget/i);
});

test('accepts a round that mixes text and a tool call: streams the preamble, keeps the content, then completes', async () => {
  const requests = [];
  const executed = [];
  const signal = new AbortController().signal;
  const registry = new ToolRegistry([tool('read_file', async (input) => {
    executed.push(input);
    return { path: input.path, text: 'content' };
  })]);
  const loop = new ReadOnlyAgentLoop(
    provider([
      [text('let me check'), call('c1', 'read_file', { path: 'src/a.ts' })],
      [text('final answer')]
    ], requests),
    registry,
    new PermissionEngine()
  );
  const deltas = [];

  const result = await loop.run(request, context(signal), 'manual', delta => deltas.push(delta), signal);

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'final answer');
  assert.deepEqual(deltas, ['let me check', 'final answer']);
  assert.deepEqual(executed[0], { path: 'src/a.ts' });
  // The assistant message carries the preamble text alongside the tool calls.
  const assistant = requests[1].request.messages.slice(-2)[0];
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.content, 'let me check');
  assert.equal(assistant.toolCalls.length, 1);
  assert.equal(assistant.toolCalls[0].name, 'read_file');
});

test('emits toolCall then toolResult via onToolEvent for every executed tool', async () => {
  const events = [];
  const signal = new AbortController().signal;
  const registry = new ToolRegistry([tool('read_file', async (input) => ({ path: input.path, text: 'content' }))]);
  const loop = new ReadOnlyAgentLoop(
    provider([
      [call('c1', 'read_file', { path: 'src/a.ts' })],
      [text('done')]
    ], []),
    registry,
    new PermissionEngine()
  );

  const result = await loop.run(request, context(signal), 'manual', () => {}, signal, event => events.push(event));

  assert.equal(result.status, 'completed');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'toolCall');
  assert.equal(events[0].name, 'read_file');
  assert.deepEqual(events[0].input, { path: 'src/a.ts' });
  assert.equal(events[1].type, 'toolResult');
  assert.equal(events[1].outcome, 'succeeded');
  assert.match(events[1].summary, /content/);
});

test('emits a failed toolResult when the tool throws', async () => {
  const events = [];
  const signal = new AbortController().signal;
  const registry = new ToolRegistry([tool('read_file', async () => { throw new Error('boom'); })]);
  const loop = new ReadOnlyAgentLoop(
    provider([[call('c1', 'read_file', { path: 'a' })], [text('done')]], []),
    registry,
    new PermissionEngine()
  );

  const result = await loop.run(request, context(signal), 'manual', () => {}, signal, event => events.push(event));

  assert.equal(result.status, 'completed');
  assert.equal(events[1].type, 'toolResult');
  assert.equal(events[1].outcome, 'failed');
  assert.match(events[1].summary, /boom/);
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

test('a streak of refusals stops the run and hands control back', async () => {
  const write = tool('replace_text', async () => ({ replacements: 1 }));
  write.risk = 'workspaceWrite';
  write.mutatesWorkspace = true;
  // Fresh arguments every round, so the repeated-call guard does not fire first
  // and the denial budget is what ends the run.
  let round = 0;
  const provider = {
    async *streamAgent() {
      round += 1;
      yield { type: 'toolCall', call: { id: `c${round}`, name: 'replace_text', input: { path: `src/a${round}.ts` } } };
    }
  };
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([write]),
    new PermissionEngine(),
    { maxConsecutiveDenials: 3 }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'plan', () => {}, signal);

  // Continuing is bounded (docs/04: CC escalates after 3 consecutive or 20 total,
  // Codex breaks the turn after 3 consecutive or 10-in-50).
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /Stopped after 3 refused action/);
  assert.equal(result.executions.filter(item => item.outcome === 'failed').length, 3);
  assert.equal(round, 3, 'the loop stopped at the budget instead of burning every round');
});

test('a call that actually ran resets the refusal streak', async () => {
  const write = tool('replace_text', async () => ({ replacements: 1 }));
  write.risk = 'workspaceWrite';
  write.mutatesWorkspace = true;
  const read = tool('read_file', async () => ({ text: 'ok' }));
  const rounds = [
    call('c1', 'replace_text', { path: 'a' }),
    call('c2', 'read_file', { path: 'a' }),
    call('c3', 'replace_text', { path: 'b' }),
    call('c4', 'read_file', { path: 'b' })
  ];
  const provider = {
    async *streamAgent() {
      const next = rounds.shift();
      if (next) {
        yield next;
        return;
      }
      yield text('done');
    }
  };
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([write, read]),
    new PermissionEngine(),
    { maxConsecutiveDenials: 2 }
  );
  const signal = new AbortController().signal;

  // Two writes are refused in Plan mode, but each is followed by a read that runs,
  // so the streak never reaches the budget.
  const result = await loop.run(request, context(signal), 'plan', () => {}, signal);

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'done');
});
