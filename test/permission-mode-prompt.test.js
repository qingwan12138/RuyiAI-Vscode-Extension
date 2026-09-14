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
    // The briefing must not tell the model to pre-emptively refuse — DSH recorded
    // a "soft lockout" (zero-tool-call turns) from that framing — it has to send
    // the model to the refusal instead.
    assert.match(briefing, /do not pre-emptively refuse/i);
    assert.match(briefing, /do not look for a way around it/i);
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

test('Plan mode invites a proposal without forbidding the attempt', () => {
  const briefing = permissionModeSystemMessage('plan');
  assert.match(briefing, /BLOCKED/);
  assert.match(briefing, /Prefer to analyse and propose/);
  assert.match(briefing, /Manual or Accept Edits/, 'the user needs to be told how to unblock it');
  // The soft-lockout guard: state the fact, but keep the model trying and reading
  // the refusal rather than going passive.
  assert.equal(/Do not attempt/.test(briefing), false, 'a prohibitive framing caused a documented soft lockout');
  assert.match(briefing, /do not pre-emptively refuse/i);
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

test('every permission mode reaches the model as its own briefing', async () => {
  // Not just Plan: the loop must forward whichever mode the session is in, so a
  // hardcoded mode would show up here as five identical briefings.
  const delivered = new Map();
  const signal = new AbortController().signal;

  for (const mode of MODES) {
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

    const result = await loop.run(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { sessionId: 's', workspaceUri: 'file:///w', signal },
      mode,
      () => undefined,
      signal
    );

    assert.equal(result.status, 'completed', `${mode}: a read tool runs in every mode`);
    assert.equal(requests.length, 2, `${mode}: the loop continued after the read`);
    for (const request of requests) {
      const systems = request.messages.filter(message => message.role === 'system');
      assert.equal(systems.length, 1, `${mode}: exactly one briefing, not one per round`);
      assert.equal(request.messages[0].role, 'system', `${mode}: the briefing leads the conversation`);
      assert.equal(
        systems[0].content,
        permissionModeSystemMessage(mode),
        `${mode}: the model must receive that mode's briefing`
      );
    }
    // The caller's own messages are preserved verbatim after the briefing.
    assert.deepEqual(requests[0].messages[1], { role: 'user', content: 'hi' });
    delivered.set(mode, requests[0].messages[0].content);
  }

  assert.equal(
    new Set(delivered.values()).size,
    MODES.length,
    'a loop that ignored the mode would deliver the same briefing to every mode'
  );
});
