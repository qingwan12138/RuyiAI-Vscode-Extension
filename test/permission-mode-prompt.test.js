// The permission-mode briefing the agent loop prepends to every run.
//
// Regression context: the model was never told which mode it was in, so in Plan
// mode it attempted a workspace write, the engine denied it, and the whole run
// failed with "Plan mode blocks state-changing and privileged actions." instead
// of answering or proposing anything.

const test = require('node:test');
const assert = require('node:assert/strict');

const { permissionModeSystemMessage } = require('../dist/yisi/application/agent/permissionModePrompt');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

const MODES = ['plan', 'manual', 'acceptEdits', 'auto', 'fullAccess'];

test('every permission mode gets its own briefing naming the mode', () => {
  const briefings = MODES.map(mode => permissionModeSystemMessage(mode));
  assert.equal(new Set(briefings).size, MODES.length, 'each mode must read differently');
  for (const briefing of briefings) {
    assert.ok(briefing.length > 0);
    assert.match(briefing, /Current permission mode:/);
    // The briefing has to say what to do instead, not only what is forbidden.
    assert.match(briefing, /do not retry it/i);
  }
  assert.match(permissionModeSystemMessage('plan'), /Current permission mode: Plan/);
  assert.match(permissionModeSystemMessage('acceptEdits'), /Current permission mode: Accept Edits/);
  assert.match(permissionModeSystemMessage('fullAccess'), /Current permission mode: Full Access/);
});

// These two couple the wording to the real engine. If PermissionEngine's verdict
// for a mode changes, the briefing must change with it, or the model is being
// told something untrue.
function assertBriefingMatchesEngine(risk) {
  const engine = new PermissionEngine();
  const request = { risk, mutatesWorkspace: true };
  for (const mode of MODES) {
    const briefing = permissionModeSystemMessage(mode);
    const outcome = engine.evaluate(mode, request).outcome;
    if (outcome === 'deny') {
      assert.match(briefing, /BLOCKED/, `${mode}/${risk}: engine denies, briefing must warn`);
    } else {
      assert.equal(
        /BLOCKED/.test(briefing),
        false,
        `${mode}/${risk}: engine permits, briefing must not claim it is blocked`
      );
    }
    if (outcome === 'confirm') {
      assert.match(briefing, /approval/i, `${mode}/${risk}: engine asks, briefing must mention approval`);
    }
  }
}

test('the briefing agrees with the engine about workspace writes', () => {
  assertBriefingMatchesEngine('workspaceWrite');
});

test('the briefing agrees with the engine about command execution', () => {
  assertBriefingMatchesEngine('processExec');
});

test('Plan mode tells the model to propose instead of attempting the write', () => {
  const briefing = permissionModeSystemMessage('plan');
  assert.match(briefing, /Do not attempt them/);
  assert.match(briefing, /Manual or Accept Edits/, 'the user needs to be told how to unblock it');
});

function readTool() {
  return {
    id: 'read_file',
    description: 'Read a file',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ ok: true })
  };
}

test('the agent loop leads every round with exactly one briefing', async () => {
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: 'read_file', input: {} } };
      } else {
        yield { type: 'textDelta', text: 'done' };
      }
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry([readTool()]), new PermissionEngine());
  const signal = new AbortController().signal;

  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal },
    'plan',
    () => undefined,
    signal
  );

  assert.equal(result.status, 'completed');
  assert.equal(requests.length, 2, 'a read tool runs in Plan mode, so the loop continues');
  for (const request of requests) {
    const systems = request.messages.filter(message => message.role === 'system');
    assert.equal(systems.length, 1, 'exactly one briefing, not one per round');
    assert.equal(request.messages[0].role, 'system', 'the briefing leads the conversation');
    assert.match(systems[0].content, /Current permission mode: Plan/);
  }
  // The caller's own messages are preserved verbatim after the briefing.
  assert.deepEqual(requests[0].messages[1], { role: 'user', content: 'hi' });
});
