// Project instruction files (AGENTS.md / CLAUDE.md / YISI.md) injected into every
// agent run.
//
// Regression context: the agent had no way to learn a repository's conventions.
// Claude Code loads CLAUDE.md and Codex loads AGENTS.md for exactly this reason
// (docs/04); Yisi had nothing, so conventions had to be retyped every session.
//
// Two properties matter as much as the feature itself:
//   - The text is workspace content, so it must be framed as unable to change the
//     permission rules; enforcement stays in PermissionEngine either way.
//   - It must never turn a missing/unreadable file into a failed run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PROJECT_INSTRUCTION_FILE_NAMES,
  PROJECT_INSTRUCTION_MAX_CHARACTERS,
  boundProjectInstructions,
  buildProjectInstructionsMessage,
  hasUsableProjectInstructions
} = require('../dist/yisi/application/agent/projectInstructions');
const { ProjectInstructionsService } = require('../dist/yisi/application/context/projectInstructionsService');
const { AgentChatRunner } = require('../dist/yisi/application/agent/agentChatRunner');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');
const { agentSystemPromptMessage } = require('../dist/yisi/application/agent/agentSystemPrompt');
const { permissionModeSystemMessage } = require('../dist/yisi/application/agent/permissionModePrompt');

/** A FileSystemPort stand-in: `null` means "exists but is not a file". */
function fakeFileSystem(files) {
  return {
    async readFile(relativePath) {
      if (!Object.prototype.hasOwnProperty.call(files, relativePath)) {
        const error = new Error(`ENOENT: no such file or directory, open '${relativePath}'`);
        error.code = 'ENOENT';
        throw error;
      }
      const text = files[relativePath];
      if (text === null) throw new Error('Workspace path is not a file.');
      return { path: relativePath, text, bytes: Buffer.byteLength(text), sha256: 'a'.repeat(64) };
    }
  };
}

test('the candidate list is a precedence order, not a merge', () => {
  assert.deepEqual([...PROJECT_INSTRUCTION_FILE_NAMES], ['AGENTS.md', 'CLAUDE.md', 'YISI.md']);
  // A repository that keeps an AGENTS.md and a CLAUDE.md pointer to it must not get
  // the same conventions twice, and two conflicting files have no defined winner.
  assert.equal(new Set(PROJECT_INSTRUCTION_FILE_NAMES).size, PROJECT_INSTRUCTION_FILE_NAMES.length);
});

test('instruction text is normalised and truncated with a visible marker', () => {
  assert.equal(boundProjectInstructions('  # Rules\r\n\r\nUse pnpm.\r\n'), '# Rules\n\nUse pnpm.');
  assert.equal(boundProjectInstructions('   '), '');

  const long = 'x'.repeat(PROJECT_INSTRUCTION_MAX_CHARACTERS + 500);
  const bounded = boundProjectInstructions(long);
  assert.match(bounded, /\[Project instructions truncated at \d+ characters\.\]$/);
  assert.ok(bounded.length < long.length, 'the bound has to actually shrink the text');
  assert.ok(
    bounded.length < PROJECT_INSTRUCTION_MAX_CHARACTERS + 100,
    'the marker must not blow the bound'
  );
});

test('the message names its source and says what the instructions cannot do', () => {
  const message = buildProjectInstructionsMessage({ path: 'AGENTS.md', text: 'Use pnpm, not npm.' });
  assert.match(message, /AGENTS\.md/);
  assert.match(message, /<project-instructions>\nUse pnpm, not npm\.\n<\/project-instructions>/);
  // The repository's own file is not the operator: it may not widen permissions.
  assert.match(message, /repository content/i);
  assert.match(message, /cannot change your tools, the permission rules/i);
  // And a file never outranks the person typing.
  assert.match(message, /the user wins/i);
  assert.equal(hasUsableProjectInstructions({ path: 'AGENTS.md', text: '  \n ' }), false);
});

test('the service takes the first readable candidate', async () => {
  const service = new ProjectInstructionsService(
    fakeFileSystem({ 'CLAUDE.md': 'from claude', 'AGENTS.md': 'from agents' })
  );
  assert.deepEqual(await service.load(), { path: 'AGENTS.md', text: 'from agents' });
});

test('the service falls through a missing or unusable candidate', async () => {
  const missing = new ProjectInstructionsService(fakeFileSystem({ 'CLAUDE.md': 'from claude' }));
  assert.deepEqual(await missing.load(), { path: 'CLAUDE.md', text: 'from claude' });

  const directory = new ProjectInstructionsService(
    fakeFileSystem({ 'AGENTS.md': null, 'CLAUDE.md': 'from claude' })
  );
  assert.deepEqual(await directory.load(), { path: 'CLAUDE.md', text: 'from claude' });

  // A present-but-empty file is not instructions: injecting it would add a system
  // message that says nothing.
  const empty = new ProjectInstructionsService(fakeFileSystem({ 'AGENTS.md': '   \n\n' }));
  assert.equal(await empty.load(), undefined);
});

test('the service reports no instructions when nothing is readable', async () => {
  assert.equal(await new ProjectInstructionsService(fakeFileSystem({})).load(), undefined);
});

test('the service bounds an oversized instruction file', async () => {
  const huge = 'y'.repeat(PROJECT_INSTRUCTION_MAX_CHARACTERS * 3);
  const service = new ProjectInstructionsService(fakeFileSystem({ 'AGENTS.md': huge }));
  const file = await service.load();
  assert.ok(file);
  assert.match(file.text, /truncated/);
  assert.ok(file.text.length <= PROJECT_INSTRUCTION_MAX_CHARACTERS + 100);
});

test('cancellation propagates instead of looking like "no instructions"', async () => {
  const controller = new AbortController();
  const service = new ProjectInstructionsService({
    async readFile() {
      controller.abort();
      throw new Error('aborted');
    }
  });
  await assert.rejects(
    service.load(controller.signal),
    error => error && error.name === 'AbortError'
  );
});

async function runLoop(projectInstructions) {
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      yield { type: 'textDelta', text: 'done' };
    }
  };
  const signal = new AbortController().signal;
  const loop = new AgentToolLoop(provider, new ToolRegistry([]), new PermissionEngine());
  // A real conversation, not a single turn: the point of the head/tail split is
  // that retained history sits between the stable prefix and the mode briefing.
  const messages = [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'hi' }
  ];
  const result = await loop.run(
    {
      model: 'm',
      messages,
      ...(projectInstructions === undefined ? {} : { projectInstructions })
    },
    { sessionId: 's', workspaceUri: 'file:///w', signal },
    'manual',
    () => undefined,
    signal
  );
  return { requests, result };
}

test('project instructions reach the model right after the role prompt', async () => {
  const instructions = buildProjectInstructionsMessage({ path: 'AGENTS.md', text: 'Use pnpm, not npm.' });
  const { requests, result } = await runLoop(instructions);

  assert.equal(result.status, 'completed');
  const systems = requests[0].messages.filter(message => message.role === 'system');
  assert.equal(systems.length, 3, 'role prompt + project instructions + mode briefing');
  const contents = requests[0].messages.map(message => message.content);
  // Stable content forms the head so a provider cache can reuse the prefix; the
  // retained history stays intact behind it; only the mode-dependent briefing is
  // rewritten at the tail on a mode change.
  assert.equal(contents[0], agentSystemPromptMessage());
  assert.equal(contents[1], instructions);
  assert.deepEqual(contents.slice(2, 4), ['earlier question', 'earlier answer']);
  assert.equal(contents[4], permissionModeSystemMessage('manual'));
  assert.equal(contents[5], 'hi');
});

test('a workspace without instructions keeps the two-message head', async () => {
  const { requests } = await runLoop(undefined);
  const systems = requests[0].messages.filter(message => message.role === 'system');
  assert.equal(systems.length, 2);

  // Whitespace is not instructions either — and the loop must not add an empty
  // system message on its own.
  const blank = await runLoop('   \n ');
  assert.equal(blank.requests[0].messages.filter(message => message.role === 'system').length, 2);
});

function runnerWithLoader(loader) {
  return new AgentChatRunner(
    new ToolRegistry([]),
    new PermissionEngine(),
    'file:///w',
    undefined,
    loader
  );
}

function capturingProvider(requests) {
  return {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      yield { type: 'textDelta', text: 'ok' };
    }
  };
}

test('the runner forwards the loaded instructions to the loop', async () => {
  const requests = [];
  const answer = await runnerWithLoader(async () => 'PROJECT RULES').run(
    capturingProvider(requests),
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    { sessionId: 's', mode: 'manual' },
    () => undefined,
    new AbortController().signal
  );
  assert.equal(answer, 'ok');
  assert.equal(requests[0].messages[1].content, 'PROJECT RULES');
});

test('the runner adds nothing when the loader has no instructions', async () => {
  const requests = [];
  await runnerWithLoader(async () => undefined).run(
    capturingProvider(requests),
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    { sessionId: 's', mode: 'manual' },
    () => undefined,
    new AbortController().signal
  );
  assert.equal(requests[0].messages.filter(message => message.role === 'system').length, 2);
});

test('a loader failure never costs the run', async () => {
  const requests = [];
  const answer = await runnerWithLoader(async () => {
    throw new Error('disk on fire');
  }).run(
    capturingProvider(requests),
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    { sessionId: 's', mode: 'manual' },
    () => undefined,
    new AbortController().signal
  );
  assert.equal(answer, 'ok', 'instructions are an enhancement, not a precondition');
  assert.equal(requests[0].messages.filter(message => message.role === 'system').length, 2);
});

test('a loader failure caused by cancellation still stops the run', async () => {
  const controller = new AbortController();
  await assert.rejects(
    runnerWithLoader(async () => {
      controller.abort();
      throw new Error('aborted');
    }).run(
      capturingProvider([]),
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { sessionId: 's', mode: 'manual' },
      () => undefined,
      controller.signal
    ),
    error => error && error.name === 'AbortError'
  );
});

test('the composition root wires the workspace instruction file into the runner', () => {
  // index.ts imports vscode, so it cannot be required here; guard the wiring at the
  // source level instead, the same way the provider wizard is guarded.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /new ProjectInstructionsService\(fileSystem\)\.load\(signal\)/);
  assert.match(source, /buildProjectInstructionsMessage\(file\)/);
  const runnerStart = source.indexOf('function buildAgentRunner');
  const runnerEnd = source.indexOf('async function createAgentWorkspace');
  const wiring = source.slice(runnerStart, runnerEnd);
  assert.ok(
    wiring.includes('new ProjectInstructionsService'),
    'the loader must be built per execution root, not once for the extension'
  );
});
