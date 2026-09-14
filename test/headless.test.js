// Headless runs: the CI / programmatic entry point.
//
// The important properties:
//   - the **default is read-only**: a run nobody is watching cannot change the
//     workspace, because plan mode refuses every state-changing action;
//   - writing is an **explicit opt-in**, and even then `destructive` /
//     `credentialSensitive` have no channel and fail closed;
//   - the same agent core runs without VS Code, proven end to end on a real
//     directory with a real edit applied to disk.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HEADLESS_ALLOWABLE_RISKS,
  HEADLESS_REFUSED_RISKS,
  HeadlessPolicyError,
  parseHeadlessArguments,
  resolveHeadlessPolicy
} = require('../dist/yisi/application/agent/headlessPolicy');
const { runHeadlessTask } = require('../dist/yisi/headless/taskRunner');
const { main } = require('../dist/yisi/headless/cli');

// --- policy ----------------------------------------------------------------

test('a headless run is read-only unless the caller opts in', () => {
  const policy = resolveHeadlessPolicy();
  assert.equal(policy.mode, 'plan', 'the safe case is the default case');
  assert.equal(policy.confirmations, undefined, 'no approval channel exists by default');
  assert.deepEqual(policy.allowed, []);
  assert.deepEqual(policy.refused, [...HEADLESS_REFUSED_RISKS]);
});

test('opting in selects a mode where the approver is actually consulted', () => {
  const policy = resolveHeadlessPolicy({ allow: ['workspaceWrite', 'processExec'] });
  // Manual asks about every state-changing action, so the approver decides —
  // accepting edits silently would make the allow list meaningless.
  assert.equal(policy.mode, 'manual');
  assert.ok(policy.confirmations, 'an opt-in needs an approver');
  assert.deepEqual(policy.allowed, ['workspaceWrite', 'processExec']);
});

test('what a human cannot be asked about cannot be auto-approved', () => {
  for (const risk of HEADLESS_REFUSED_RISKS) {
    assert.throws(() => resolveHeadlessPolicy({ allow: [risk] }), HeadlessPolicyError);
  }
  assert.deepEqual([...HEADLESS_ALLOWABLE_RISKS], ['workspaceWrite', 'processExec', 'environmentChange']);
});

test('an allow list that could never apply is rejected, not ignored', () => {
  // Plan denies everything state-changing, so allowing writes alongside it is a
  // contradiction; silently ignoring the flag would hide it.
  assert.throws(() => resolveHeadlessPolicy({ mode: 'plan', allow: ['workspaceWrite'] }), /cannot be combined/);
});

test('the approver answers by risk class, and has no channel for the rest', async () => {
  const policy = resolveHeadlessPolicy({ allow: ['workspaceWrite'] });
  const request = { callId: 'c', toolId: 'replace_text', input: {}, reason: 'x' };
  assert.equal(await policy.confirmations.confirm({ ...request, risk: 'workspaceWrite' }, undefined), true);
  // Not listed -> no channel. The loop maps a thrown approval to `unavailable`
  // (fail closed), which is honest: nobody declined, nobody could be asked.
  await assert.rejects(policy.confirmations.confirm({ ...request, risk: 'destructive' }, undefined), /No approval channel/);
});

// --- arguments -------------------------------------------------------------

test('the prompt is required and the flags parse', () => {
  assert.throws(() => parseHeadlessArguments([]), /prompt is required/i);
  assert.throws(() => parseHeadlessArguments(['--root', '/tmp']), /prompt is required/i);

  const args = parseHeadlessArguments(['--root', './p', '--model', 'm', '--json', 'explain the build']);
  assert.equal(args.root, './p');
  assert.equal(args.model, 'm');
  assert.equal(args.json, true);
  assert.equal(args.prompt, 'explain the build');
  assert.equal(args.policy.mode, 'plan');

  // Multi-word prompts survive, and inline values work too.
  const multi = parseHeadlessArguments(['fix', 'the', 'failing', 'test', '--mode=acceptEdits']);
  assert.equal(multi.prompt, 'fix the failing test');
  assert.equal(multi.policy.mode, 'acceptEdits');
  assert.equal(multi.policy.confirmations, undefined, 'acceptEdits needs no headless approver for edits');
});

test('--allow-write is the opt-in, and an unknown mode is refused', () => {
  const optIn = parseHeadlessArguments(['--allow-write', 'do it']);
  assert.equal(optIn.policy.mode, 'manual');
  assert.ok(optIn.policy.confirmations);
  assert.throws(() => parseHeadlessArguments(['--mode', 'yolo', 'do it']), /--mode must be one of/);
});

// --- end to end, without VS Code -------------------------------------------

function scratch(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-headless-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content, 'utf8');
  }
  return root;
}

/** A provider that asks to create a file, then answers. */
function writingProvider(calls) {
  return {
    async *streamAgent(request) {
      calls.push(structuredClone(request));
      if (calls.length === 1) {
        yield {
          type: 'toolCall',
          call: { id: 'c1', name: 'create_text_file', input: { path: 'written.txt', content: 'from the agent' } }
        };
        return;
      }
      yield { type: 'textDelta', text: 'finished' };
    }
  };
}

test('the default headless run cannot change the workspace', async () => {
  const root = scratch();
  const calls = [];
  const result = await runHeadlessTask({
    root,
    prompt: 'create the file',
    model: 'm',
    policy: resolveHeadlessPolicy(),
    provider: writingProvider(calls),
    signal: new AbortController().signal
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'finished');
  assert.equal(fs.existsSync(path.join(root, 'written.txt')), false, 'plan mode must not write');
  const toolMessage = JSON.parse(calls.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(toolMessage.denied, true);
  assert.equal(toolMessage.reason, 'policy');
});

test('an explicit opt-in applies a real edit to a real directory', async () => {
  const root = scratch();
  const calls = [];
  const result = await runHeadlessTask({
    root,
    prompt: 'create the file',
    model: 'm',
    policy: resolveHeadlessPolicy({ allow: ['workspaceWrite'] }),
    provider: writingProvider(calls),
    signal: new AbortController().signal
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'finished');
  assert.equal(fs.readFileSync(path.join(root, 'written.txt'), 'utf8'), 'from the agent');
  const toolMessage = JSON.parse(calls.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(toolMessage.ok, true);
});

test('the headless run carries the workspace context and the same tool set', async () => {
  const root = scratch({ 'AGENTS.md': 'Use pnpm, not npm.' });
  fs.mkdirSync(path.join(root, '.yisi', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.yisi', 'skills', 'deploy.md'), '---\nname: deploy\ndescription: Ship it.\n---\nSteps.');

  const calls = [];
  await runHeadlessTask({
    root,
    prompt: 'hi',
    model: 'm',
    policy: resolveHeadlessPolicy(),
    provider: {
      async *streamAgent(request) {
        calls.push(structuredClone(request));
        yield { type: 'textDelta', text: 'ok' };
      }
    },
    signal: new AbortController().signal
  });
  const systems = calls[0].messages.filter(message => message.role === 'system');
  assert.ok(systems.some(message => /Use pnpm, not npm/.test(message.content)), 'project instructions apply');
  assert.ok(systems.some(message => /- deploy: Ship it\./.test(message.content)), 'skills apply');
  assert.match(systems.at(-1).content, /Current permission mode: Plan/);
});

test('a run that cannot proceed reports why instead of throwing', async () => {
  const root = scratch();
  const result = await runHeadlessTask({
    root,
    prompt: 'do something',
    model: 'm',
    policy: resolveHeadlessPolicy(),
    provider: {
      async *streamAgent() {
        // Never emits anything: the loop's own guards stop the run.
      }
    },
    signal: new AbortController().signal
  });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /empty agent output/i);
});

// --- the CLI contract ------------------------------------------------------

function environment(overrides = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    env: name => (name === 'YISI_API_KEY' ? 'test-key' : undefined),
    write: text => out.push(text),
    writeError: text => err.push(text),
    ...overrides
  };
}

test('--help prints usage and exits 0, without needing a key or a prompt', async () => {
  const args = parseHeadlessArguments(['--help']);
  assert.equal(args.help, true);
  assert.equal(args.prompt, '', 'usage must not be answered with "a prompt is required"');

  const cli = environment({ env: () => undefined });
  assert.equal(await main(['--help'], cli), 0, 'usage is not a failure');
  const out = cli.out.join('');
  assert.match(out, /Usage: yisi-headless \[options\] "what to do"/);
  assert.match(out, /READ-ONLY/, 'the safe default has to be stated where people look first');
  assert.match(out, /never auto-approved/);
  assert.match(out, /Exit codes: 0 completed, 1 stopped, 2 bad arguments/);
  assert.equal(cli.err.length, 0, 'nothing goes to stderr for a help request');
});

test('the CLI exits 2 for bad arguments and for a missing key', async () => {
  const bad = environment();
  assert.equal(await main(['--mode', 'yolo', 'go'], bad), 2);
  assert.match(bad.err.join(''), /--mode must be one of/);

  const noKey = environment({ env: () => undefined });
  assert.equal(await main(['go'], noKey), 2);
  assert.match(noKey.err.join(''), /No API key/);
});

test('the CLI prints the answer and exits 0, or reports a stop and exits 1', async () => {
  const calls = [];
  const ok = environment({ createProvider: () => writingProvider(calls) });
  const okCode = await main(['--root', scratch(), 'create it'], ok);
  assert.equal(okCode, 0);
  assert.match(ok.out.join(''), /finished/);

  const blocked = environment({
    createProvider: () => ({ async *streamAgent() {} })
  });
  const blockedCode = await main(['--root', scratch(), 'do it'], blocked);
  assert.equal(blockedCode, 1);
  assert.match(blocked.err.join(''), /stopped:/);
});

test('--json streams NDJSON events with the result last', async () => {
  const calls = [];
  const cli = environment({ createProvider: () => writingProvider(calls) });
  assert.equal(await main(['--root', scratch(), '--json', 'create it'], cli), 0);

  // Every line is a JSON object: nothing human-readable is interleaved.
  const lines = cli.out.join('').split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'the stream must not be empty');
  const events = lines.map(line => JSON.parse(line));

  // A refused call reports one `failed` event and no `call` event: nothing ran, so
  // there is no call to report — and the stream still says *why* nothing was
  // written, which is the point of streaming a CI run.
  const toolEvents = events.filter(event => event.type === 'tool');
  assert.deepEqual(toolEvents.map(event => event.outcome), ['failed']);
  assert.equal(toolEvents[0].name, 'create_text_file');
  assert.match(toolEvents[0].summary, /Plan mode blocks/i);

  // The answer is streamed too, and the result is always the last line.
  assert.ok(events.some(event => event.type === 'delta' && /finished/.test(event.text)));
  const last = events.at(-1);
  assert.equal(last.type, 'result');
  assert.equal(last.status, 'completed');
  assert.equal(last.text, 'finished');
});

test('a blocked headless run still ends with a machine-readable result', async () => {
  const cli = environment({
    createProvider: () => ({ async *streamAgent() {} })
  });
  assert.equal(await main(['--root', scratch(), '--json', 'do it'], cli), 1);
  const events = cli.out.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const last = events.at(-1);
  assert.equal(last.type, 'result');
  assert.equal(last.status, 'blocked');
  assert.match(last.reason, /empty agent output/i);
});

test('tool events map onto the stream shape', () => {
  const { toolEventToHeadless } = require('../dist/yisi/headless/events');
  assert.deepEqual(toolEventToHeadless({ type: 'toolCall', id: 'c1', name: 'read_file', input: {} }), {
    type: 'tool',
    id: 'c1',
    name: 'read_file',
    outcome: 'call'
  });
  assert.deepEqual(
    toolEventToHeadless({ type: 'toolResult', id: 'c1', name: 'read_file', outcome: 'failed', truncated: false, summary: 'nope' }),
    { type: 'tool', id: 'c1', name: 'read_file', outcome: 'failed', summary: 'nope' }
  );
});
