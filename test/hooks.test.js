// Hooks: configuration, the service that runs them, and their effect on the agent
// loop.
//
// The invariant these tests exist to protect: **a hook may only ever tighten**.
// There is no decision that grants permission, an "allow" does not skip the
// permission engine or the approval card, and a hook refusal is not a policy
// refusal (so it must not unlock a permission escalation that could never lift
// it). The process-backed executor is covered in test/hooks-process.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseHookConfigurations, hookMatchesTool } = require('../dist/yisi/application/hooks/hookConfiguration');
const { HookService } = require('../dist/yisi/application/hooks/hookService');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

const SIGNAL = new AbortController().signal;

// --- configuration ---------------------------------------------------------

test('an absent or empty setting configures no hooks', () => {
  assert.deepEqual(parseHookConfigurations(undefined), { hooks: [], rejected: [] });
  assert.deepEqual(parseHookConfigurations([]), { hooks: [], rejected: [] });
  assert.deepEqual(parseHookConfigurations('nope').rejected.length, 1);
});

test('a hook is parsed with defaults that fail closed for pre-tool hooks', () => {
  const { hooks, rejected } = parseHookConfigurations([
    { event: 'preToolUse', command: 'node', args: ['guard.js'] },
    { event: 'postToolUse', command: 'node', args: ['lint.js'], match: 'replace_text', timeoutMs: 500 }
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(hooks[0], {
    event: 'preToolUse',
    command: 'node',
    args: ['guard.js'],
    match: '*',
    timeoutMs: 10_000,
    // A guardrail that silently stops guarding is worse than one that stops the
    // action, so this default is deliberately the strict one.
    onError: 'block'
  });
  assert.equal(hooks[1].onError, 'continue', 'a post-tool hook only adds context, so it fails open');
  assert.equal(hooks[1].match, 'replace_text');
  assert.equal(hooks[1].timeoutMs, 500);
});

test('malformed hooks are rejected with a reason rather than guessed at', () => {
  const cases = [
    {},
    { event: 'onSave', command: 'node' },
    { event: 'preToolUse' },
    { event: 'preToolUse', command: '  ' },
    { event: 'preToolUse', command: 'node', args: 'x' },
    { event: 'preToolUse', command: 'node', args: [1] },
    { event: 'preToolUse', command: 'node', match: '' },
    { event: 'preToolUse', command: 'node', timeoutMs: 0 },
    { event: 'preToolUse', command: 'node', timeoutMs: 999_999 },
    { event: 'preToolUse', command: 'node', onError: 'ignore' },
    'not an object'
  ];
  for (const entry of cases) {
    const result = parseHookConfigurations([entry]);
    assert.deepEqual(result.hooks, [], `${JSON.stringify(entry)} must not configure a hook`);
    assert.equal(result.rejected.length, 1, `${JSON.stringify(entry)} must be reported`);
  }
});

test('one bad hook does not discard the good ones', () => {
  const result = parseHookConfigurations([
    { event: 'preToolUse', command: 'node' },
    { event: 'nope', command: 'node' },
    { event: 'postToolUse', command: 'node' }
  ]);
  assert.deepEqual(result.hooks.map(hook => hook.event), ['preToolUse', 'postToolUse']);
  assert.deepEqual(result.rejected, [{ index: 1, reason: 'An "event" of either "preToolUse" or "postToolUse" is required.' }]);
});

test('tool matching covers an exact id and a namespace wildcard', () => {
  assert.equal(hookMatchesTool('*', 'anything'), true);
  assert.equal(hookMatchesTool('replace_text', 'replace_text'), true);
  assert.equal(hookMatchesTool('replace_text', 'replace_text_2'), false);
  assert.equal(hookMatchesTool('mcp__github__*', 'mcp__github__list_issues'), true);
  assert.equal(hookMatchesTool('mcp__github__*', 'mcp__gitlab__list_issues'), false);
  // Regex metacharacters in a tool id must be treated literally.
  assert.equal(hookMatchesTool('a.b', 'axb'), false);
});

// --- service ---------------------------------------------------------------

function hook(overrides = {}) {
  return {
    event: 'preToolUse',
    command: 'node',
    args: [],
    match: '*',
    timeoutMs: 1_000,
    onError: 'block',
    ...overrides
  };
}

function executorReturning(...results) {
  const calls = [];
  return {
    calls,
    executor: {
      async execute(configured, payload, signal) {
        calls.push({ configured, payload, signal });
        const next = results.shift();
        if (!next) return {};
        if (typeof next === 'function') return next(configured, payload);
        return next;
      }
    }
  };
}

const REQUEST = {
  toolId: 'replace_text',
  risk: 'workspaceWrite',
  mutatesWorkspace: true,
  input: { path: 'a.txt' },
  sessionId: 's1'
};

test('a pre-tool hook can refuse, and the refusal stops the other hooks', async () => {
  const { executor, calls } = executorReturning(
    { decision: 'deny', reason: 'the guardrail says no' },
    { decision: 'allow' }
  );
  const service = new HookService([hook(), hook()], executor);
  const result = await service.preToolUse(REQUEST, SIGNAL);
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason, 'the guardrail says no');
  assert.equal(calls.length, 1, 'nothing is gained by asking the rest once the action is refused');
});

test('a pre-tool hook that fails blocks by default, and says why', async () => {
  const { executor } = executorReturning({ error: 'spawn ENOENT' });
  const service = new HookService([hook()], executor);
  const result = await service.preToolUse(REQUEST, SIGNAL);
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /could not run/);
  assert.match(result.reason, /ENOENT/);
});

test('onError:continue lets the action through but keeps the failure visible', async () => {
  const { executor } = executorReturning({ error: 'spawn ENOENT' });
  const service = new HookService([hook({ onError: 'continue' })], executor);
  const result = await service.preToolUse(REQUEST, SIGNAL);
  assert.equal(result.decision, 'allow');
  // Silently dropping the failure would be a guardrail that stopped guarding.
  assert.match(result.context, /could not run/);
});

test('hooks run in configuration order and their context accumulates', async () => {
  const { executor, calls } = executorReturning({ context: 'first' }, { context: 'second' });
  const service = new HookService([hook({ event: 'postToolUse' }), hook({ event: 'postToolUse' })], executor);
  const result = await service.postToolUse({ ...REQUEST, outcome: 'succeeded', result: '{}' }, SIGNAL);
  assert.equal(result.context, 'first\n\nsecond');
  assert.equal(calls.length, 2, 'post-tool hooks are additive, not short-circuited');
  assert.equal(calls[0].payload.event, 'postToolUse');
  assert.equal(calls[0].payload.tool.id, 'replace_text');
  assert.equal(calls[0].payload.outcome, 'succeeded');
});

test('a post-tool denial is reported as context, never as a veto that cannot happen', async () => {
  const { executor } = executorReturning({ decision: 'deny', reason: 'the edit broke the build' });
  const service = new HookService([hook({ event: 'postToolUse' })], executor);
  const result = await service.postToolUse({ ...REQUEST, outcome: 'succeeded', result: '{}' }, SIGNAL);
  assert.equal(result.decision, 'allow');
  assert.match(result.context, /broke the build/);
});

test('only matching hooks run', async () => {
  const { executor, calls } = executorReturning({ decision: 'deny' });
  const service = new HookService([hook({ match: 'mcp__github__*' })], executor);
  assert.equal((await service.preToolUse(REQUEST, SIGNAL)).decision, 'allow');
  assert.equal(calls.length, 0);

  await service.preToolUse({ ...REQUEST, toolId: 'mcp__github__list_issues' }, SIGNAL);
  assert.equal(calls.length, 1);
});

test('a cancelled run is not turned into a hook refusal', async () => {
  const controller = new AbortController();
  const { executor } = executorReturning(() => {
    controller.abort();
    return { error: 'The run was cancelled.' };
  });
  const service = new HookService([hook()], executor);
  const result = await service.preToolUse(REQUEST, controller.signal);
  // The loop calls throwIfAborted right after, so the run stops as cancelled
  // rather than reporting a bogus guardrail refusal.
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.decision, 'deny');
});

// --- effect on the agent loop ---------------------------------------------

function readTool(id = 'read_file') {
  return {
    id,
    description: 'Read a file',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ text: 'file contents' })
  };
}

function writeTool() {
  return {
    id: 'replace_text',
    description: 'Replace text',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ ok: true })
  };
}

async function runLoop({ mode, tools, hooks, confirmations }) {
  const seen = [];
  const provider = {
    async *streamAgent(request) {
      seen.push(structuredClone(request));
      if (seen.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: tools[0].id, input: {} } };
      } else {
        yield { type: 'textDelta', text: 'done' };
      }
    }
  };
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry(tools),
    new PermissionEngine(),
    {},
    confirmations,
    hooks
  );
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's1', workspaceUri: 'file:///w', signal: SIGNAL },
    mode,
    () => undefined,
    SIGNAL
  );
  const toolMessage = seen.at(-1).messages.find(message => message.role === 'tool');
  return {
    result,
    toolMessage: toolMessage ? JSON.parse(toolMessage.content) : undefined,
    executions: result.executions
  };
}

function hookPort(overrides = {}) {
  const calls = { pre: [], post: [] };
  return {
    calls,
    port: {
      async preToolUse(request) {
        calls.pre.push(request);
        return overrides.pre ? overrides.pre(request) : { decision: 'allow' };
      },
      async postToolUse(request) {
        calls.post.push(request);
        return overrides.post ? overrides.post(request) : { decision: 'allow' };
      }
    }
  };
}

test('a hook refusal is reported to the model as a hook refusal, not a policy one', async () => {
  const tool = writeTool();
  let executed = 0;
  tool.execute = async () => {
    executed += 1;
    return { ok: true };
  };
  const { port } = hookPort({ pre: () => ({ decision: 'deny', reason: 'no writes to that path', hook: 'guard' }) });
  const { result, toolMessage, executions } = await runLoop({ mode: 'manual', tools: [tool], hooks: port });

  assert.equal(result.status, 'completed', 'a refusal is a tool outcome, not a dead run');
  assert.equal(executed, 0, 'a refused action must not execute');
  assert.equal(toolMessage.denied, true);
  assert.equal(toolMessage.reason, 'hook');
  assert.match(toolMessage.error, /no writes to that path/);
  assert.match(toolMessage.guidance, /not a permission-mode decision/i);
  assert.equal(executions[0].outcome, 'failed');
});

test('a hook refusal does not unlock a permission escalation', async () => {
  // Widening the mode could never lift a hook, so crediting it as a policy denial
  // would send the model chasing an escalation that cannot help.
  const requestPermission = {
    id: 'request_permission',
    description: 'Ask for a wider mode',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: false,
    permissionEscalation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      throw new Error('the loop intercepts this tool and must never execute it');
    }
  };
  const seen = [];
  const provider = {
    async *streamAgent(request) {
      seen.push(structuredClone(request));
      if (seen.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: requestPermission.id, input: { mode: 'acceptEdits', justification: 'need to write' } } };
      } else if (seen.length === 2) {
        yield { type: 'toolCall', call: { id: 'c2', name: 'replace_text', input: {} } };
      } else {
        yield { type: 'textDelta', text: 'done' };
      }
    }
  };
  const approvals = [];
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([requestPermission, writeTool()]),
    new PermissionEngine(),
    {},
    { async confirm(request) { approvals.push(request); return true; } },
    hookPort({ pre: () => ({ decision: 'deny', reason: 'no' }) }).port
  );
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's1', workspaceUri: 'file:///w', signal: SIGNAL },
    'plan',
    () => undefined,
    SIGNAL
  );

  assert.equal(result.status, 'completed');
  const escalationReply = seen.at(-1).messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  assert.equal(escalationReply[0].reason, 'policy', 'a hook refusal is not grounds for an escalation');
  assert.match(escalationReply[0].error, /nothing has been refused in this run yet/i);
  assert.equal(approvals.length, 0, 'the user is never asked to widen the mode');
});

test('a hook that allows still leaves the permission engine in charge', async () => {
  // The whole point of "hooks may only tighten": an allow is not an approval.
  const { port } = hookPort({ pre: () => ({ decision: 'allow' }) });
  const { toolMessage } = await runLoop({ mode: 'manual', tools: [writeTool()], hooks: port });
  assert.equal(toolMessage.reason, 'unavailable', 'Manual still needs an approval channel');

  const approvals = [];
  const withApproval = await runLoop({
    mode: 'manual',
    tools: [writeTool()],
    hooks: port,
    confirmations: {
      async confirm(request) {
        approvals.push(request);
        return true;
      }
    }
  });
  assert.equal(approvals.length, 1, 'the approval card still appears');
  assert.equal(withApproval.toolMessage.ok, true);
});

test('hook context reaches the model, both before and after execution', async () => {
  const { port, calls } = hookPort({
    pre: () => ({ decision: 'allow', context: 'remember: this repo forbids editing vendor/' }),
    post: () => ({ decision: 'allow', context: 'lint: 2 warnings' })
  });
  const { toolMessage } = await runLoop({ mode: 'acceptEdits', tools: [readTool()], hooks: port });

  assert.equal(calls.pre.length, 1);
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].outcome, 'succeeded');
  assert.match(calls.post[0].result, /file contents/, 'the hook sees what the tool produced');
  assert.match(toolMessage.hookContext, /forbids editing vendor/);
  assert.match(toolMessage.hookContext, /lint: 2 warnings/);
  assert.equal(toolMessage.ok, true, 'the result stays a parseable tool payload');
});

test('no hooks configured means the loop behaves exactly as before', async () => {
  const { toolMessage } = await runLoop({ mode: 'acceptEdits', tools: [readTool()], hooks: undefined });
  assert.equal(toolMessage.ok, true);
  assert.equal('hookContext' in toolMessage, false);
});

test('the composition root wires hooks and the manifest declares the setting', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /createAgentHooks\(\)/);
  assert.match(source, /new HookService\(hooks, new NodeHookExecutor\(\{ cwd: root \}\)\)/);
  assert.match(source, /getConfiguration\('yisiAI'\)\.get<unknown>\('hooks'\)/);

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const property = manifest.contributes.configuration.properties['yisiAI.hooks'];
  assert.ok(property, 'yisiAI.hooks must be declared');
  assert.deepEqual(property.items.required, ['event', 'command']);
  assert.deepEqual(property.items.properties.event.enum, ['preToolUse', 'postToolUse']);
});
