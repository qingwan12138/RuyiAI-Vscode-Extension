// The permission-mode briefing the agent loop prepends to every run.
//
// Regression context: the model was never told which mode it was in, so in Plan
// mode it attempted a workspace write, the engine denied it, and the whole run
// failed with "Plan mode blocks state-changing and privileged actions." instead
// of answering or proposing anything.

const test = require('node:test');
const assert = require('node:assert/strict');

const { permissionModeSystemMessage } = require('../dist/yisi/application/agent/permissionModePrompt');
const { agentSystemPromptMessage } = require('../dist/yisi/application/agent/agentSystemPrompt');
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
  // The reviewed exit: the model is told it can ask to apply a finished plan.
  assert.match(briefing, /request_permission/);
  assert.match(briefing, /acceptEdits/, 'the plan must say which mode to ask for');
  // The soft-lockout guard: state the fact, but keep the model trying and reading
  // the refusal rather than going passive.
  assert.equal(/Do not attempt/.test(briefing), false, 'a prohibitive framing caused a documented soft lockout');
  assert.match(briefing, /do not pre-emptively refuse/i);
});

test('every mode explains the escalation rules', () => {
  for (const mode of MODES) {
    const briefing = permissionModeSystemMessage(mode);
    assert.match(briefing, /request_permission/, `${mode}: the model must know the channel exists`);
    assert.match(briefing, /strictly wider/, `${mode}: the constraint has to be stated`);
  }
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
      // Two system messages by design: the stable role/tool-use policy at the
      // head, and the mode briefing immediately before the current user turn.
      assert.equal(systems.length, 2, `${mode}: the role prompt plus the mode briefing`);
      assert.equal(
        request.messages[0].content,
        agentSystemPromptMessage(),
        `${mode}: the stable role prompt leads the conversation`
      );
      const briefingIndex = request.messages.findIndex(
        message => message.role === 'system' && message.content !== agentSystemPromptMessage()
      );
      assert.equal(
        request.messages[briefingIndex].content,
        permissionModeSystemMessage(mode),
        `${mode}: the model must receive that mode's briefing`
      );
      assert.equal(
        request.messages[briefingIndex + 1].content,
        'hi',
        `${mode}: the briefing sits after the history and immediately before the user turn`
      );
    }
    // The caller's own messages are preserved verbatim, after both system parts.
    assert.deepEqual(requests[0].messages.at(-1), { role: 'user', content: 'hi' });
    delivered.set(mode, permissionModeSystemMessage(mode));
  }

  assert.equal(
    new Set(delivered.values()).size,
    MODES.length,
    'a loop that ignored the mode would deliver the same briefing to every mode'
  );
});

test('the agent path carries a role and tool-use policy at the head', () => {
  const prompt = agentSystemPromptMessage();
  // The reported transcript: "请你介绍一下RISC-V吧" produced a ruyi_check call and
  // a list_directory call, because nothing told the model that a general question
  // needs no tools while ~24 tool definitions sat in front of it.
  assert.match(prompt, /answered from what you already know/i);
  assert.match(prompt, /Use tools when the task depends on facts about this workspace/i);
  assert.match(prompt, /smallest set of tools/i);
  assert.match(prompt, /Answer in the language the user wrote in/i);
  // Mode restrictions belong to the mode briefing, not here: this part must stay
  // stable so it can sit in a cached prefix.
  assert.equal(/permission mode|BLOCKED|approval/i.test(prompt), false);
});
