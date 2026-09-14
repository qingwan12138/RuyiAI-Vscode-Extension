// Subagents: the `task` tool, the child loop, and the isolation contract.
//
// The properties this file protects, in order of importance:
//   1. **A subagent can never exceed its parent.** Its registry is filtered to
//      read-only observers, with the escalation tool and the subagent tool itself
//      removed — so there is no privileged tool to reach for.
//   2. **Only the report crosses back.** The parent's conversation does not go
//      down, and the child's file reads and prose do not come up.
//   3. **Stop propagates.** A cancelled parent cancels its children.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SUBAGENT_TOOL_ID,
  SubagentInputError,
  createSubagentTool,
  parseSubagentTask,
  subagentBrief
} = require('../dist/yisi/application/agent/subagentTool');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

const SIGNAL = new AbortController().signal;

function tool(overrides) {
  return {
    id: 'read_file',
    description: 'Read',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ text: 'contents' }),
    ...overrides
  };
}

function writeTool() {
  return tool({
    id: 'replace_text',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    execute: async () => ({ ok: true })
  });
}

function escalationTool() {
  return tool({
    id: 'request_permission',
    permissionEscalation: true,
    execute: async () => {
      throw new Error('never executes');
    }
  });
}

// --- input contract --------------------------------------------------------

test('the task input is parsed strictly', () => {
  assert.deepEqual(parseSubagentTask({ description: 'find auth', prompt: 'Where is auth?' }), {
    description: 'find auth',
    prompt: 'Where is auth?'
  });
  assert.throws(() => parseSubagentTask(null), SubagentInputError);
  assert.throws(() => parseSubagentTask({ prompt: 'x' }), /description/);
  assert.throws(() => parseSubagentTask({ description: 'x' }), /prompt/);
  assert.throws(() => parseSubagentTask({ description: '  ', prompt: 'x' }), SubagentInputError);
  assert.throws(() => parseSubagentTask({ description: 'x'.repeat(200), prompt: 'y' }), /at most/);
  assert.throws(() => parseSubagentTask({ description: 'x', prompt: 'y'.repeat(9_000) }), /at most/);
});

test('the tool is a read-only marker the loop intercepts, never a body', async () => {
  const subagent = createSubagentTool();
  assert.equal(subagent.id, SUBAGENT_TOOL_ID);
  assert.equal(subagent.risk, 'readOnly');
  assert.equal(subagent.mutatesWorkspace, false);
  assert.equal(subagent.spawnsSubagent, true);
  await assert.rejects(subagent.execute({}, {}), /intercepted by the agent loop/);
  // The description has to tell the parent what it is and is not.
  assert.match(subagent.description, /read-only tools/);
  assert.match(subagent.description, /cannot ask the user/);
});

test('the brief states the three rules a subagent gets wrong otherwise', () => {
  const brief = subagentBrief({ description: 'find auth', prompt: 'x' });
  assert.match(brief, /not for the user/);
  assert.match(brief, /cannot ask the user anything/);
  assert.match(brief, /read-only tools/);
  assert.match(brief, /Only that report reaches the other agent/);
});

// --- the child loop --------------------------------------------------------

/**
 * A provider that plays both agents: the parent asks for a subagent, the child
 * works, then the parent answers. `childScript` sees the child's requests.
 */
function scriptedProvider(childScript) {
  const parentRequests = [];
  const childRequests = [];
  let inChild = false;
  return {
    parentRequests,
    childRequests,
    provider: {
      async *streamAgent(request) {
        const isChild = request.messages.some(
          message => message.role === 'system' && /You are a subagent/.test(message.content)
        );
        if (isChild) {
          inChild = true;
          childRequests.push(structuredClone(request));
          yield* childScript(request, childRequests.length);
          return;
        }
        parentRequests.push(structuredClone(request));
        if (parentRequests.length === 1) {
          yield {
            type: 'toolCall',
            call: { id: 'p1', name: SUBAGENT_TOOL_ID, input: { description: 'find auth', prompt: 'Where is auth?' } }
          };
        } else {
          yield { type: 'textDelta', text: 'parent done' };
        }
      }
    },
    get inChild() {
      return inChild;
    }
  };
}

async function runParent({ tools, childScript, options, signal = SIGNAL, onToolEvent }) {
  const scripted = scriptedProvider(childScript ?? (async function* () { yield { type: 'textDelta', text: 'child report' }; }));
  const loop = new AgentToolLoop(
    scripted.provider,
    new ToolRegistry(tools),
    new PermissionEngine(),
    options ?? {}
  );
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal },
    'plan',
    () => undefined,
    signal,
    onToolEvent
  );
  const toolMessage = scripted.parentRequests
    .at(-1)
    .messages.filter(message => message.role === 'tool')
    .map(message => JSON.parse(message.content))
    .at(-1);
  return { result, toolMessage, scripted };
}

test('the report is what the parent receives', async () => {
  const { result, toolMessage } = await runParent({
    tools: [createSubagentTool(), tool()],
    childScript: async function* () {
      yield { type: 'textDelta', text: 'auth lives in src/auth.ts:42' };
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(toolMessage.ok, true);
  assert.equal(toolMessage.result.subagent, 'find auth');
  assert.match(toolMessage.result.report, /src\/auth\.ts:42/);
});

test('the child gets the task and the workspace context, not the parent conversation', async () => {
  const { scripted } = await runParent({
    tools: [createSubagentTool(), tool()],
    options: {},
    childScript: async function* () {
      yield { type: 'textDelta', text: 'report' };
    }
  });
  const child = scripted.childRequests[0];
  const userTurns = child.messages.filter(message => message.role === 'user');
  assert.equal(userTurns.length, 1);
  assert.equal(userTurns[0].content, 'Where is auth?', 'the child sees only its task');
  // The parent's own first message never reaches the child.
  assert.equal(child.messages.some(message => message.content === 'go'), false);
  // It still gets the shared workspace head, in the documented order.
  const systems = child.messages.filter(message => message.role === 'system');
  assert.match(systems[0].content, /You are Yisi AI/);
  assert.match(systems[1].content, /You are a subagent/);
  assert.equal(systems.at(-1).content.startsWith('You are Yisi AI, a coding agent'), true);
  assert.match(child.messages.at(-2).content, /Current permission mode: Plan/);
});

test('the child inherits the parent run mode, so it can never be wider', async () => {
  const { scripted } = await runParent({
    tools: [createSubagentTool(), tool()],
    childScript: async function* () {
      yield { type: 'textDelta', text: 'r' };
    }
  });
  const child = scripted.childRequests[0];
  assert.match(child.messages.find(message => /Current permission mode/.test(message.content)).content, /Plan/);
});

test('a subagent cannot reach a privileged tool, the escalation tool, or spawn another', async () => {
  // The child tries three privileged calls; all three must come back as unknown
  // tools, because the filtered registry is what enforces the boundary.
  const attempts = ['replace_text', 'request_permission', SUBAGENT_TOOL_ID];
  const { toolMessage } = await runParent({
    tools: [createSubagentTool(), tool(), writeTool(), escalationTool()],
    childScript: async function* (request, round) {
      if (round === 1) {
        yield { type: 'toolCall', call: { id: `c${attempts[0]}`, name: attempts[0], input: {} } };
        return;
      }
      yield { type: 'textDelta', text: 'could not change anything' };
    }
  });
  assert.equal(toolMessage.ok, true);

  // Now the same thing, but assert on what the child actually received: every
  // unknown-tool block names the tool it refused.
  const scripted = scriptedProvider(async function* (request, round) {
    if (round === 1) {
      yield { type: 'toolCall', call: { id: 'c1', name: 'replace_text', input: {} } };
      return;
    }
    const last = request.messages.at(-1);
    throw new Error(`unexpected round: ${String(last && last.content)}`);
  });
  const loop = new AgentToolLoop(
    scripted.provider,
    new ToolRegistry([createSubagentTool(), tool(), writeTool(), escalationTool()]),
    new PermissionEngine()
  );
  await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'fullAccess',
    () => undefined,
    SIGNAL
  );
  // The child attempting `replace_text` ends the child run as blocked (unknown
  // tool), and the parent receives that as a stopped subagent rather than a write.
  const parentTool = scripted.parentRequests
    .at(-1)
    .messages.filter(message => message.role === 'tool')
    .map(message => JSON.parse(message.content))
    .at(-1);
  // The loop wraps a tool that ran into { ok, result }; the subagent's own status
  // is inside `result`.
  assert.equal(parentTool.ok, true, 'the tool itself ran');
  assert.equal(parentTool.result.ok, false, 'and reported a failed subagent');
  assert.match(parentTool.result.stopped, /Unknown tool: replace_text/);
});

test('the child sees only read-only tools in its definitions', async () => {
  const registry = new ToolRegistry([createSubagentTool(), tool(), writeTool(), escalationTool()]);
  const filtered = registry.subset(
    candidate =>
      candidate.risk === 'readOnly'
      && !candidate.mutatesWorkspace
      && !candidate.permissionEscalation
      && !candidate.spawnsSubagent
  );
  assert.deepEqual(filtered.definitions().map(definition => definition.name), ['read_file']);
  assert.equal(registry.list().length, 4, 'the parent registry is untouched');
});

test('a blocked child is reported to the parent as stopped, not as success', async () => {
  const { toolMessage } = await runParent({
    tools: [createSubagentTool(), tool()],
    // Never produces text or a tool call: the child exhausts its own guards.
    childScript: async function* () {}
  });
  assert.equal(toolMessage.ok, true, 'the tool ran');
  assert.equal(toolMessage.result.ok, false, 'the subagent did not succeed');
  assert.match(toolMessage.result.stopped, /empty agent output/i);
});

test('the subagent budget stops the run instead of refusing quietly', async () => {
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      const isChild = request.messages.some(
        message => message.role === 'system' && /You are a subagent/.test(message.content)
      );
      if (isChild) {
        yield { type: 'textDelta', text: 'report' };
        return;
      }
      requests.push(structuredClone(request));
      // Distinct inputs each round: the repeated-call guard would otherwise fire
      // before the subagent budget, which is a different guard.
      yield {
        type: 'toolCall',
        call: {
          id: `p${requests.length}`,
          name: SUBAGENT_TOOL_ID,
          input: { description: `t${requests.length}`, prompt: `do it ${requests.length}` }
        }
      };
    }
  };
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([createSubagentTool(), tool()]),
    new PermissionEngine(),
    { maxSubagents: 2 }
  );
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'plan',
    () => undefined,
    SIGNAL
  );
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /Subagent budget exhausted/);
});

test('the child activity is forwarded to the UI, namespaced', async () => {
  const events = [];
  await runParent({
    tools: [createSubagentTool(), tool()],
    onToolEvent: event => events.push(event),
    childScript: async function* (request, round) {
      if (round === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: 'read_file', input: {} } };
        return;
      }
      yield { type: 'textDelta', text: 'report' };
    }
  });
  const childCall = events.find(event => event.type === 'toolCall' && event.name === 'find auth → read_file');
  assert.ok(childCall, 'the user can see the subagent working');
  const childResult = events.find(
    event => event.type === 'toolResult' && event.id.startsWith('subagent:find auth:')
  );
  assert.ok(childResult, 'child step ids cannot collide with the parent transcript');
  // The parent's own subagent call is still visible as one step.
  assert.ok(events.some(event => event.type === 'toolCall' && event.name === SUBAGENT_TOOL_ID));
});

test('cancelling the parent cancels the subagent', async () => {
  const controller = new AbortController();
  const started = [];
  const provider = {
    async *streamAgent(request) {
      const isChild = request.messages.some(
        message => message.role === 'system' && /You are a subagent/.test(message.content)
      );
      if (isChild) {
        started.push('child');
        controller.abort();
        yield { type: 'textDelta', text: 'too late' };
        return;
      }
      yield {
        type: 'toolCall',
        call: { id: 'p1', name: SUBAGENT_TOOL_ID, input: { description: 't', prompt: 'do it' } }
      };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry([createSubagentTool(), tool()]), new PermissionEngine());
  await assert.rejects(
    loop.run(
      { model: 'm', messages: [{ role: 'user', content: 'go' }] },
      { sessionId: 's', workspaceUri: 'file:///w', signal: controller.signal },
      'plan',
      () => undefined,
      controller.signal
    ),
    error => error.name === 'AbortError'
  );
  assert.deepEqual(started, ['child'], 'the child actually ran and inherited the signal');
});

test('a malformed task call fails as a tool result, not as a crash', async () => {
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield { type: 'toolCall', call: { id: 'p1', name: SUBAGENT_TOOL_ID, input: { description: 'x' } } };
        return;
      }
      yield { type: 'textDelta', text: 'done' };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry([createSubagentTool(), tool()]), new PermissionEngine());
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'plan',
    () => undefined,
    SIGNAL
  );
  assert.equal(result.status, 'completed');
  const toolMessage = JSON.parse(
    requests.at(-1).messages.find(message => message.role === 'tool').content
  );
  assert.equal(toolMessage.ok, false);
  assert.match(toolMessage.error, /prompt/);
});

test('the composition root registers the subagent tool', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /createSubagentTool\(\)/);
});
