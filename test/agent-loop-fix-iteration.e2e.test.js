// v0.3 DoD evidence (docs/12): a FAILING test auto-iterates to a fix.
// The scripted provider drives a real tool chain over a fresh fixture repo:
//   read_file -> run_command node --test (FAILS) -> replace_text (fix, sha-guided)
//   -> run_command node --test (passes) -> final text.
// This proves "失败测试可自动迭代修复" through REAL tools + REAL node --test.
// Mode 'auto': workspace writes are auto-allowed, process-exec is permission-
// confirmed via the stub, so the run stays fully gated without a dialog.

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

const FIXTURE = path.join(__dirname, 'fixtures', 'agent-loop-fix-demo');
const WORKSPACE_URI = pathToFileURL(FIXTURE).href;
const CALC = path.join(FIXTURE, 'calc.js');
const OLD_BUG = 'return a + b; // should multiply';
const NEW_FIX = 'return a * b;';

function parseContent(content) {
  try { return JSON.parse(content); } catch { return undefined; }
}

/**
 * Scripted provider: read, run test (fails), fix, run test (passes), done.
 * A phase counter avoids re-matching the same tool result.
 */
function failingFixProvider(trace) {
  let phase = 0;      // 0 read, 1 run#1, 2 fix, 3 run#2, 4 final
  let sha;
  return {
    async *streamAgent(request) {
      const last = request.messages[request.messages.length - 1];
      const parsed = last && last.role === 'tool' ? parseContent(last.content) : undefined;

      if (phase === 0) {
        trace.push('read_file');
        yield { type: 'toolCall', call: { id: 's1', name: 'read_file', input: { path: 'calc.js' } } };
        phase = 1;
        return;
      }
      if (phase === 1) {
        assert.equal(last.name, 'read_file');
        assert.ok(parsed && parsed.ok, `read_file must succeed: ${last.content}`);
        sha = parsed.result && parsed.result.sha256;
        trace.push('run_command#1');
        yield { type: 'toolCall', call: { id: 's2', name: 'run_command', input: { executable: 'node', args: ['calc.test.mjs'] } } };
        phase = 2;
        return;
      }
      if (phase === 2) {
        assert.equal(last.name, 'run_command');
        assert.ok(parsed && parsed.ok, `run_command must succeed: ${last.content}`);
        assert.equal(parsed.result.exitCode !== 0, true, 'the first test run is expected to FAIL');
        trace.push('replace_text');
        yield {
          type: 'toolCall',
          call: {
            id: 's3',
            name: 'replace_text',
            input: { path: 'calc.js', expectedSha256: sha, oldText: OLD_BUG, newText: NEW_FIX }
          }
        };
        phase = 3;
        return;
      }
      if (phase === 3) {
        assert.equal(last.name, 'replace_text');
        assert.ok(parsed && parsed.ok, `replace_text must succeed: ${last.content}`);
        trace.push('run_command#2');
        yield { type: 'toolCall', call: { id: 's4', name: 'run_command', input: { executable: 'node', args: ['calc.test.mjs'] } } };
        phase = 4;
        return;
      }
      // phase 4: run_command#2
      assert.equal(last.name, 'run_command');
      assert.equal(parsed.result.exitCode, 0, 'the second test run is expected to PASS');
      trace.push('final');
      yield { type: 'textDelta', text: 'Fixed multiply; node --test now passes.' };
      phase = 5;
    }
  };
}

async function buildRunner(confirmations) {
  const fileSystem = await NodeWorkspaceFileSystem.create(FIXTURE);
  const edits = new WorkspaceEditService(fileSystem, undefined, fileSystem);
  const commands = new CommandExecutionService(new NodeProcessRunner(), FIXTURE);
  const tools = [
    ...createWorkspaceContextTools(new WorkspaceContextService(fileSystem)),
    createWorkspaceEditTool(edits),
    createWorkspaceFileTool(edits),
    createRunCommandTool(commands)
  ];
  return new AgentChatRunner(
    new ToolRegistry(tools),
    new PermissionEngine(),
    WORKSPACE_URI,
    confirmations
  );
}

const request = { model: 'scripted', messages: [{ role: 'user', content: 'fix the failing test in calc.js' }] };

test('v0.3 DoD: a failing test auto-iterates (fail -> fix -> pass) with real tools', async () => {
  // Fresh bug baseline.
  fs.writeFileSync(CALC, fs.readFileSync(CALC, 'utf8').replace('return a * b;', OLD_BUG));
  assert.ok(fs.readFileSync(CALC, 'utf8').includes(OLD_BUG), 'fixture must start buggy');

  const trace = [];
  const approvals = [];
  const confirmations = { confirm: async info => { approvals.push(info); return true; } };
  const runner = await buildRunner(confirmations);
  const deltas = [];
  const signal = new AbortController().signal;

  const result = await runner.run(
    failingFixProvider(trace),
    request,
    { sessionId: 's-fix', mode: 'auto' },
    delta => deltas.push(delta),
    signal
  );

  // Real iteration happened: test was run, failed, fixed, run again, passed.
  assert.equal(trace.includes('run_command#1'), true, 'first validation ran');
  assert.equal(trace.includes('replace_text'), true, 'fix applied after the failure');
  assert.equal(trace.includes('run_command#2'), true, 'second validation ran');
  assert.ok(result.includes('passes'), `final text: ${result}`);
  assert.equal(deltas.join(''), result);

  // The fix is on disk and the real test passes now.
  assert.ok(fs.readFileSync(CALC, 'utf8').includes('return a * b;'));
  const verify = await new NodeProcessRunner().run(
    { executable: 'node', args: ['calc.test.mjs'], cwd: FIXTURE },
    new AbortController().signal
  );
  assert.equal(verify.status, 'exited');
  assert.equal(verify.exitCode, 0, `node calc.test.mjs should pass: ${verify.stdout.text + verify.stderr.text}`);

  // Auto mode confirmed the process-exec (validation) runs.
  const toolIds = approvals.map(item => item.toolId);
  assert.ok(toolIds.includes('run_command'), 'process-exec was permission-confirmed in auto mode');
});
