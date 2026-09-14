// v0.2 DoD end-to-end evidence (docs/12): the agent loop + tool schema +
// PermissionEngine complete "locate -> propose -> approve -> validate" against
// a real fixture repo, using a scripted (non-network) provider over REAL tools:
// read_file (schema) -> replace_text (workspace-write, Manual approval) ->
// run_command node --test (processExec, Manual approval) -> final text.
// A second run in Plan mode proves the write is denied before execution.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { NodeWorkspaceFileSystem } = require('../dist/yisi/infrastructure/context/nodeWorkspaceFileSystem');
const { NodeProcessRunner } = require('../dist/yisi/infrastructure/process/nodeProcessRunner');
const { CommandExecutionService, createRunCommandTool } = require('../dist/yisi/application/process/commandExecutionService');
const { WorkspaceContextService, createWorkspaceContextTools } = require('../dist/yisi/application/context/workspaceContextService');
const { WorkspaceEditService, createWorkspaceEditTool, createWorkspaceFileTool } = require('../dist/yisi/application/edit/workspaceEditService');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { AgentChatRunner } = require('../dist/yisi/application/agent/agentChatRunner');
const { copyFixture } = require('./support/fixtureCopy');

const FIXTURE_NAME = 'agent-loop-demo';
const OLD_BUG = 'return a + b; // should multiply';
const NEW_FIX = 'return a * b;';

function parseContent(content) {
  try { return JSON.parse(content); } catch { return undefined; }
}

/** Scripted provider: read calc.js -> replace bug (sha from read) -> run node --test -> done. */
function manualFixProvider(trace) {
  return {
    async *streamAgent(request) {
      const last = request.messages[request.messages.length - 1];
      if (!last || last.role !== 'tool') {
        trace.push('read_file');
        yield { type: 'toolCall', call: { id: 'c1', name: 'read_file', input: { path: 'calc.js' } } };
        return;
      }
      const parsed = parseContent(last.content);
      if (last.name === 'read_file' && parsed && parsed.ok) {
        const sha = parsed.result && parsed.result.sha256;
        trace.push('replace_text');
        yield { type: 'toolCall', call: { id: 'c2', name: 'replace_text', input: { path: 'calc.js', expectedSha256: sha, oldText: OLD_BUG, newText: NEW_FIX } } };
        return;
      }
      if (last.name === 'replace_text' && parsed && parsed.ok) {
        trace.push('run_command');
        yield { type: 'toolCall', call: { id: 'c3', name: 'run_command', input: { executable: 'node', args: ['calc.test.mjs'] } } };
        return;
      }
      if (last.name === 'run_command' && parsed && parsed.ok && parsed.result.status === 'exited' && parsed.result.exitCode === 0) {
        trace.push('final');
        yield { type: 'textDelta', text: 'Fixed multiply; node --test passes.' };
        return;
      }
      yield { type: 'textDelta', text: 'Could not finish automatically.' };
    }
  };
}

/** Plan-denial provider: read first, attempt an exclusive file creation, then
 * react to the refusal the way a model would. */
function planDenialProvider() {
  return {
    async *streamAgent(request) {
      const last = request.messages[request.messages.length - 1];
      if (!last || last.role !== 'tool') {
        yield { type: 'toolCall', call: { id: 'p1', name: 'read_file', input: { path: 'calc.js' } } };
        return;
      }
      const parsed = parseContent(last.content);
      if (last.name === 'read_file' && parsed && parsed.ok) {
        yield { type: 'toolCall', call: { id: 'p2', name: 'create_text_file', input: { path: 'plan-forbidden.txt', content: 'x' } } };
        return;
      }
      if (last.name === 'create_text_file' && parsed && parsed.denied) {
        yield { type: 'textDelta', text: `refused (${parsed.reason}): I will propose the change instead` };
        return;
      }
      yield { type: 'textDelta', text: 'unexpected' };
    }
  };
}

async function buildRunner(confirmations, root) {
  const fileSystem = await NodeWorkspaceFileSystem.create(root);
  const edits = new WorkspaceEditService(fileSystem, undefined, fileSystem);
  const commands = new CommandExecutionService(new NodeProcessRunner(), root);
  const tools = [
    ...createWorkspaceContextTools(new WorkspaceContextService(fileSystem)),
    createWorkspaceEditTool(edits),
    createWorkspaceFileTool(edits),
    createRunCommandTool(commands)
  ];
  const runner = new AgentChatRunner(
    new ToolRegistry(tools),
    new PermissionEngine(),
    pathToFileURL(root).href,
    confirmations
  );
  return runner;
}

const request = { model: 'scripted', messages: [{ role: 'user', content: 'locate the bug in calc.js, fix it, and verify with the test' }] };

test('v0.2 DoD: locate -> propose -> approve (Manual) -> validate on a real fixture', async () => {
  // A private copy: this test edits the fixture with the real tools, so the
  // checked-in fixture must never be the shared mutable state between runs
  // (see test/support/fixtureCopy.js).
  const workspace = copyFixture(FIXTURE_NAME);
  const root = workspace.root;
  const calc = path.join(root, 'calc.js');
  try {
    // Fresh bug baseline.
    const buggy = fs.readFileSync(calc, 'utf8');
    if (!buggy.includes(OLD_BUG)) {
      fs.writeFileSync(calc, buggy.replace('return a * b;', OLD_BUG));
    }
    const trace = [];
    const approvals = [];
    const confirmations = { confirm: async requestInfo => { approvals.push(requestInfo); return true; } };
    const runner = await buildRunner(confirmations, root);
    const provider = manualFixProvider(trace);
    const deltas = [];
    const signal = new AbortController().signal;

    const result = await runner.run(
      provider,
      request,
      { sessionId: 's-manual', mode: 'manual' },
      delta => deltas.push(delta),
      signal
    );

    assert.equal(trace.includes('read_file'), true);
    assert.equal(trace.includes('replace_text'), true);
    assert.equal(trace.includes('run_command'), true);
    assert.ok(result.includes('passes'), `final text should confirm tests: ${result}`);
    assert.equal(deltas.join(''), result);

    // The real file changed (approval path worked end-to-end).
    const fixed = fs.readFileSync(calc, 'utf8');
    assert.ok(fixed.includes('return a * b;'), 'multiply must be fixed on disk');
    // Manual approvals were requested for the workspace write and the process run.
    const toolIds = approvals.map(item => item.toolId);
    assert.ok(toolIds.includes('replace_text'));
    assert.ok(toolIds.includes('run_command'));

    // Validation evidence: run the actual test now — it must exit 0.
    const verify = await new NodeProcessRunner().run(
      { executable: 'node', args: ['calc.test.mjs'], cwd: root },
      new AbortController().signal
    );
    assert.equal(verify.status, 'exited');
    assert.equal(verify.exitCode, 0, `node calc.test.mjs should pass: ${verify.stdout.text + verify.stderr.text}`);
  } finally {
    workspace.cleanup();
  }
});

test('v0.2 PermissionEngine: Plan mode denies a workspace write before executing it', async () => {
  const workspace = copyFixture(FIXTURE_NAME);
  const root = workspace.root;
  try {
    const target = path.join(root, 'plan-forbidden.txt');
    const runner = await buildRunner({ confirm: async () => { throw new Error('Plan mode must not ask for confirmation'); } }, root);
    const provider = planDenialProvider();
    const signal = new AbortController().signal;

    // The essential property is unchanged: Plan mode never creates the file. What
    // changed is the mechanism — the refusal reaches the model as a tool outcome
    // labelled `policy`, and the run continues so it can propose instead of the
    // whole turn dying with a red error (docs/04: all three reference agents
    // return the refusal to the model and continue).
    const text = await runner.run(provider, request, { sessionId: 's-plan', mode: 'plan' }, () => undefined, signal);

    assert.match(text, /refused \(policy\)/, 'the model must be told why, and which kind of refusal it was');
    assert.equal(fs.existsSync(target), false, 'Plan mode must not create the file');

    // And the checked-in fixture is untouched by either test.
    assert.match(fs.readFileSync(path.join(workspace.source, 'calc.js'), 'utf8'), /return a \* b;/);
  } finally {
    workspace.cleanup();
  }
});
