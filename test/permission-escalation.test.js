// Structured permission escalation (docs/04: Codex's `request_permissions`,
// DSH's one grounded / strictly-wider / human-approved retry). This is also how
// Plan mode gets a reviewed exit: the agent presents what it wants to apply and
// asks to be allowed to apply it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');
const {
  REQUEST_PERMISSION_TOOL_ID,
  createRequestPermissionTool,
  parsePermissionEscalation
} = require('../dist/yisi/application/agent/requestPermissionTool');
const { PERMISSION_MODE_ORDER, isWiderPermissionMode } = require('../dist/yisi/domain/permissionMode');

const context = signal => ({ sessionId: 'session-1', workspaceUri: 'file:///workspace', signal });
const request = { model: 'model', messages: [{ role: 'user', content: 'apply the plan' }] };
const call = (id, name, input) => ({ type: 'toolCall', call: { id, name, input } });
const text = value => ({ type: 'textDelta', text: value });

function readTool(executed) {
  return {
    id: 'read_file',
    description: 'Read a file',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => { executed.push('read'); return { text: 'ok' }; }
  };
}

function writeTool(executed) {
  return {
    id: 'replace_text',
    description: 'Edit a file',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async input => { executed.push(input.path); return { replacements: 1 }; }
  };
}

function commandTool(executed) {
  return {
    id: 'run_command',
    description: 'Run a command',
    risk: 'processExec',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => { executed.push('command'); return { status: 'exited', exitCode: 0 }; }
  };
}

/** A provider that plays a fixed script of rounds. */
function scriptedProvider(rounds, requests = []) {
  return {
    async *streamAgent(request_) {
      requests.push({ request: structuredClone(request_) });
      const next = rounds.shift();
      if (!next) {
        yield text('done');
        return;
      }
      yield next;
    }
  };
}

test('permission modes are ordered so "strictly wider" is checkable', () => {
  assert.deepEqual([...PERMISSION_MODE_ORDER], ['plan', 'manual', 'acceptEdits', 'auto', 'fullAccess']);
  assert.equal(isWiderPermissionMode('plan', 'manual'), true);
  assert.equal(isWiderPermissionMode('plan', 'fullAccess'), true);
  assert.equal(isWiderPermissionMode('manual', 'acceptEdits'), true);
  assert.equal(isWiderPermissionMode('acceptEdits', 'auto'), true);
  // Never wider: the same mode, or anything narrower.
  assert.equal(isWiderPermissionMode('fullAccess', 'fullAccess'), false);
  assert.equal(isWiderPermissionMode('auto', 'acceptEdits'), false);
  assert.equal(isWiderPermissionMode('manual', 'plan'), false);
});

test('the escalation tool asks rather than acts', async () => {
  const tool = createRequestPermissionTool();
  assert.equal(tool.id, REQUEST_PERMISSION_TOOL_ID);
  assert.equal(tool.permissionEscalation, true);
  assert.equal(tool.mutatesWorkspace, false);
  // It must never run: the loop intercepts it, and reaching execute means the
  // interception was lost.
  await assert.rejects(() => tool.execute({}, { sessionId: 's', workspaceUri: 'file:///w', signal: new AbortController().signal }));
});

test('a malformed escalation request is rejected by the parser', () => {
  assert.deepEqual(parsePermissionEscalation({ mode: 'acceptEdits', justification: '  ready to apply  ' }), {
    mode: 'acceptEdits',
    justification: 'ready to apply'
  });
  // plan is the narrowest mode, so it is not a valid target.
  assert.equal(parsePermissionEscalation({ mode: 'plan', justification: 'x' }), undefined);
  assert.equal(parsePermissionEscalation({ mode: 'manual' }), undefined);
  assert.equal(parsePermissionEscalation({ mode: 'manual', justification: '   ' }), undefined);
  assert.equal(parsePermissionEscalation({ mode: 'nonsense', justification: 'x' }), undefined);
  assert.equal(parsePermissionEscalation(null), undefined);
  assert.equal(parsePermissionEscalation('acceptEdits'), undefined);
  const long = parsePermissionEscalation({ mode: 'auto', justification: 'y'.repeat(500) });
  assert.ok(long.justification.length <= 240);
});

test('an approved escalation lets Plan mode apply the plan it reviewed', async () => {
  // This is the reviewed exit: refused first, then the agent asks, the user
  // approves, and the same work now runs — for this run only.
  const executed = [];
  const confirmations = [];
  const requests = [];
  const provider = scriptedProvider([
    call('c1', 'replace_text', { path: 'src/first.ts' }),
    call('c2', REQUEST_PERMISSION_TOOL_ID, { mode: 'acceptEdits', justification: 'the plan is ready to apply' }),
    call('c3', 'replace_text', { path: 'src/second.ts' }),
    text('applied both edits')
  ], requests);
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([readTool(executed), writeTool(executed), createRequestPermissionTool()]),
    new PermissionEngine(),
    {},
    { confirm: async (ask, signal) => { confirmations.push({ ask, signal }); return true; } }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'plan', () => undefined, signal);

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'applied both edits');
  // Only the post-approval edit ran; the first attempt was refused.
  assert.deepEqual(executed, ['src/second.ts']);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].ask.toolId, REQUEST_PERMISSION_TOOL_ID);
  assert.deepEqual(confirmations[0].ask.input, { mode: 'acceptEdits', justification: 'the plan is ready to apply' });
  assert.match(confirmations[0].ask.reason, /acceptEdits/);
  assert.equal(confirmations[0].signal, signal);
  // The model is told the new effective mode.
  const approval = JSON.parse(requests[2].request.messages.at(-1).content);
  assert.equal(approval.ok, true);
  assert.equal(approval.mode, 'acceptEdits');
  assert.match(approval.note, /until this run ends/);
});

test('an escalation without a prior refusal is refused and never asks the user', async () => {
  const executed = [];
  let asks = 0;
  const requests = [];
  const provider = scriptedProvider([
    call('c1', REQUEST_PERMISSION_TOOL_ID, { mode: 'acceptEdits', justification: 'just in case' }),
    text('understood')
  ], requests);
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([readTool(executed), createRequestPermissionTool()]),
    new PermissionEngine(),
    {},
    { confirm: async () => { asks += 1; return true; } }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'plan', () => undefined, signal);

  assert.equal(result.status, 'completed');
  assert.equal(asks, 0, 'nothing was refused, so there is nothing to escalate from');
  const denial = JSON.parse(requests[1].request.messages.at(-1).content);
  assert.equal(denial.reason, 'policy');
  assert.match(denial.error, /must follow a refusal/);
});

test('an escalation that is not strictly wider is refused', async () => {
  const executed = [];
  const requests = [];
  const provider = scriptedProvider([
    call('c1', 'replace_text', { path: 'src/a.ts' }),
    call('c2', REQUEST_PERMISSION_TOOL_ID, { mode: 'manual', justification: 'let me try again' }),
    text('understood')
  ], requests);
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([writeTool(executed), createRequestPermissionTool()]),
    // A policy that refuses in acceptEdits gives us the policy refusal an
    // escalation needs, while leaving "manual" narrower than the current mode.
    {
      evaluate: mode => (mode === 'acceptEdits'
        ? { outcome: 'deny', allowed: false, needsConfirmation: false, reason: 'blocked by the policy under test' }
        : { outcome: 'allow', allowed: true, needsConfirmation: false, reason: 'allowed under test' })
    },
    {},
    { confirm: async () => { throw new Error('an escalation that is not wider must never reach the user'); } }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'acceptEdits', () => undefined, signal);

  assert.equal(result.status, 'completed');
  assert.deepEqual(executed, []);
  const denial = JSON.parse(requests[2].request.messages.at(-1).content);
  assert.equal(denial.reason, 'policy');
  assert.match(denial.error, /not strictly wider/);
});

test('an escalation after a user decline is refused instead of nagging', async () => {
  const executed = [];
  const requests = [];
  let asks = 0;
  const provider = scriptedProvider([
    call('c1', 'run_command', { executable: 'ctest' }),
    call('c2', REQUEST_PERMISSION_TOOL_ID, { mode: 'fullAccess', justification: 'please let me run the tests' }),
    text('understood')
  ], requests);
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([commandTool(executed), createRequestPermissionTool()]),
    new PermissionEngine(),
    {},
    { confirm: async () => { asks += 1; return false; } }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'acceptEdits', () => undefined, signal);

  assert.equal(result.status, 'completed');
  // Only the command was ever asked about. The user said no, so the run does not
  // come back asking to be allowed a wider mode.
  assert.equal(asks, 1);
  const denial = JSON.parse(requests[2].request.messages.at(-1).content);
  assert.equal(denial.reason, 'policy');
  assert.match(denial.error, /user already declined/);
});

test('a declined escalation leaves the mode alone and is not asked twice', async () => {
  const executed = [];
  const requests = [];
  let asks = 0;
  const provider = scriptedProvider([
    call('c1', 'replace_text', { path: 'src/a.ts' }),
    call('c2', REQUEST_PERMISSION_TOOL_ID, { mode: 'acceptEdits', justification: 'apply the plan' }),
    call('c3', REQUEST_PERMISSION_TOOL_ID, { mode: 'fullAccess', justification: 'try harder' }),
    call('c4', 'replace_text', { path: 'src/b.ts' }),
    text('understood — nothing was changed')
  ], requests);
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([readTool(executed), writeTool(executed), createRequestPermissionTool()]),
    new PermissionEngine(),
    // The denial budget has to allow three refusals here: the edit, the declined
    // escalation, and the second edit.
    { maxConsecutiveDenials: 10 },
    { confirm: async () => { asks += 1; return false; } }
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'plan', () => undefined, signal);

  assert.equal(result.status, 'completed');
  assert.deepEqual(executed, [], 'the mode never widened, so neither edit ran');
  assert.equal(asks, 1, 'a declined escalation is not asked again in the same run');
  const declined = JSON.parse(requests[2].request.messages.at(-1).content);
  assert.equal(declined.reason, 'user');
  assert.match(declined.guidance, /Do not repeat it/);
  const repeat = JSON.parse(requests[3].request.messages.at(-1).content);
  assert.equal(repeat.reason, 'policy');
  assert.match(repeat.error, /already requested/);
});

test('an escalation with no approval channel fails closed', async () => {
  const executed = [];
  const requests = [];
  const provider = scriptedProvider([
    call('c1', 'replace_text', { path: 'src/a.ts' }),
    call('c2', REQUEST_PERMISSION_TOOL_ID, { mode: 'acceptEdits', justification: 'apply the plan' }),
    text('understood')
  ], requests);
  // No confirmation port at all.
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([readTool(executed), writeTool(executed), createRequestPermissionTool()]),
    new PermissionEngine()
  );
  const signal = new AbortController().signal;

  const result = await loop.run(request, context(signal), 'plan', () => undefined, signal);

  assert.equal(result.status, 'completed');
  const denial = JSON.parse(requests[2].request.messages.at(-1).content);
  assert.equal(denial.reason, 'unavailable');
  assert.match(denial.error, /No approval channel/);
});
