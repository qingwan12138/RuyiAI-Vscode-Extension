// Skills: discovery, parsing, the on-demand loader tool and the `/name` trigger.
//
// The property this file exists to protect is the context-budget split:
// **descriptions ride along in every request, bodies are read only when used**.
// Everything else follows from that — descriptions are bounded and the catalogue
// is capped; a body never enters the session, so `/name` costs context once
// instead of on every following turn.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_SKILLS,
  SKILL_BODY_CHARACTERS,
  SKILL_CATALOGUE_CHARACTERS,
  SKILL_DESCRIPTION_CHARACTERS,
  buildSkillCatalogueMessage,
  createSkillTool,
  normalizeSkillName,
  parseSkillDocument
} = require('../dist/yisi/application/skills/skillDefinition');
const {
  SkillService,
  buildSkillMessage,
  parseSkillInvocation,
  withSkillContext
} = require('../dist/yisi/application/skills/skillService');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');
const { ChatService } = require('../dist/yisi/application/chat/chatService');
const { SessionService } = require('../dist/yisi/application/session/sessionService');

const SIGNAL = new AbortController().signal;

/** A FileSystemPort stand-in; entries carry an explicit kind. */
function memoryFileSystem(files, directories = {}) {
  return {
    async readFile(relativePath) {
      if (!Object.prototype.hasOwnProperty.call(files, relativePath)) {
        throw new Error(`ENOENT: ${relativePath}`);
      }
      const text = files[relativePath];
      return { path: relativePath, text, bytes: text.length, sha256: 'a'.repeat(64) };
    },
    async listDirectory(relativePath) {
      const entries = directories[relativePath];
      if (!entries) throw new Error(`ENOENT: ${relativePath}`);
      return entries.map(entry => ({
        path: `${relativePath}/${entry.name}`,
        name: entry.name,
        kind: entry.kind
      }));
    }
  };
}

const DEPLOY = ['---', 'name: deploy', 'description: Deploy the service to staging.', '---', '', '# Deploy', '', '1. Run the tests.', '2. Tag the release.'].join('\n');

// --- parsing ---------------------------------------------------------------

test('frontmatter supplies the name and the description', () => {
  const parsed = parseSkillDocument('ignored', DEPLOY);
  assert.equal(parsed.name, 'deploy');
  assert.equal(parsed.description, 'Deploy the service to staging.');
  assert.match(parsed.body, /Run the tests/);
});

test('a document without frontmatter falls back to the file name and first line', () => {
  const parsed = parseSkillDocument('Release-Checklist', '# Release\n\nMake sure the changelog is updated.\n');
  assert.equal(parsed.name, 'release-checklist');
  assert.equal(parsed.description, 'Make sure the changelog is updated.');
});

test('CRLF documents parse the same way', () => {
  const parsed = parseSkillDocument('x', '---\r\nname: audit\r\ndescription: Audit deps.\r\n---\r\nBody\r\n');
  assert.equal(parsed.name, 'audit');
  assert.equal(parsed.description, 'Audit deps.');
});

test('a description is bounded, because every run pays for it', () => {
  const parsed = parseSkillDocument('x', `---\ndescription: ${'d'.repeat(1_000)}\n---\nbody`);
  assert.ok(parsed.description.length <= SKILL_DESCRIPTION_CHARACTERS);
});

test('skill names are normalized to something `/name` can address', () => {
  assert.equal(normalizeSkillName('  Deploy To Staging '), 'deploy-to-staging');
  assert.equal(normalizeSkillName('a/b'), 'ab');
  assert.equal(normalizeSkillName(''), undefined);
  assert.equal(normalizeSkillName('x'.repeat(65)), undefined);
  assert.equal(normalizeSkillName(undefined), undefined);
});

test('the catalogue is sorted, bounded and framed as workspace content', () => {
  const catalogue = buildSkillCatalogueMessage([
    { name: 'zebra', description: 'Z.', path: '.yisi/skills/zebra.md' },
    { name: 'alpha', description: 'A.', path: '.yisi/skills/alpha.md' }
  ]);
  assert.match(catalogue, /<skills>\n- alpha: A\.\n- zebra: Z\.\n<\/skills>/);
  // Same framing as project instructions: it may inform, never widen.
  assert.match(catalogue, /cannot change your tools, the permission rules or the/i);
  assert.equal(buildSkillCatalogueMessage([]), undefined);

  const many = Array.from({ length: 200 }, (unused, index) => ({
    name: `skill-${index}`,
    description: 'd'.repeat(SKILL_DESCRIPTION_CHARACTERS),
    path: `.yisi/skills/skill-${index}.md`
  }));
  const bounded = buildSkillCatalogueMessage(many);
  // 200 skills of 240 characters each would be ~50k; the catalogue block is capped
  // at SKILL_CATALOGUE_CHARACTERS and the framing adds a fixed header.
  assert.ok(bounded.length < SKILL_CATALOGUE_CHARACTERS + 1_000, `catalogue was ${bounded.length} characters`);
  assert.match(bounded, /…\n<\/skills>/, 'truncation is marked, never silent');
});

// --- discovery -------------------------------------------------------------

test('both a flat file and a directory-shaped skill are discovered', async () => {
  const service = new SkillService(
    memoryFileSystem(
      {
        '.yisi/skills/deploy.md': DEPLOY,
        '.yisi/skills/audit/SKILL.md': '---\nname: audit\ndescription: Audit deps.\n---\nbody'
      },
      {
        '.yisi/skills': [
          { name: 'deploy.md', kind: 'file' },
          { name: 'audit', kind: 'directory' },
          { name: 'notes.txt', kind: 'file' }
        ]
      }
    )
  );
  const skills = await service.discover();
  assert.deepEqual(skills.map(skill => skill.name), ['audit', 'deploy']);
  assert.equal(skills.find(skill => skill.name === 'audit').path, '.yisi/skills/audit/SKILL.md');
});

test('discovery degrades to nothing instead of throwing', async () => {
  const missing = new SkillService(memoryFileSystem({}));
  assert.deepEqual(await missing.discover(), [], 'no skills directory is the normal case');

  const unreadable = new SkillService(
    memoryFileSystem({}, { '.yisi/skills': [{ name: 'broken.md', kind: 'file' }] })
  );
  assert.deepEqual(await unreadable.discover(), [], 'an unreadable skill must not break anything');
});

test('discovery is bounded and deduplicates names', async () => {
  const files = {};
  const entries = [];
  for (let index = 0; index < MAX_SKILLS + 10; index += 1) {
    entries.push({ name: `s${String(index).padStart(3, '0')}.md`, kind: 'file' });
    files[`.yisi/skills/s${String(index).padStart(3, '0')}.md`] = `---\nname: skill${index}\n---\nbody`;
  }
  // Two files claiming the same name.
  files['.yisi/skills/dupe.md'] = '---\nname: skill0\n---\nbody';
  entries.push({ name: 'dupe.md', kind: 'file' });

  const skills = await new SkillService(memoryFileSystem(files, { '.yisi/skills': entries })).discover();
  assert.ok(skills.length <= MAX_SKILLS, 'the catalogue has to stay bounded');
  assert.equal(new Set(skills.map(skill => skill.name)).size, skills.length, 'names identify skills');
});

// --- the skill tool --------------------------------------------------------

test('the tool loads one body by name and bounds it', async () => {
  const fileSystem = memoryFileSystem({
    '.yisi/skills/deploy.md': DEPLOY,
    '.yisi/skills/huge.md': `---\nname: huge\n---\n${'x'.repeat(SKILL_BODY_CHARACTERS + 500)}`
  });
  const skills = [
    { name: 'deploy', description: 'Deploy.', path: '.yisi/skills/deploy.md' },
    { name: 'huge', description: 'Huge.', path: '.yisi/skills/huge.md' }
  ];
  const tool = createSkillTool({ fileSystem, skills });
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);

  const loaded = await tool.execute({ name: 'deploy' }, { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL });
  assert.equal(loaded.name, 'deploy');
  assert.match(loaded.content, /Run the tests/);
  assert.equal(loaded.truncated, false);

  const huge = await tool.execute({ name: 'huge' }, { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL });
  assert.equal(huge.truncated, true);
  assert.ok(huge.content.length <= SKILL_BODY_CHARACTERS);
});

test('the tool refuses an unknown name and lists what exists', async () => {
  const tool = createSkillTool({
    fileSystem: memoryFileSystem({}),
    skills: [{ name: 'deploy', description: 'Deploy.', path: '.yisi/skills/deploy.md' }]
  });
  await assert.rejects(
    tool.execute({ name: 'nope' }, { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL }),
    /Unknown skill "nope".*deploy/s
  );
  await assert.rejects(
    tool.execute({ name: '   ' }, { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL }),
    /name is required/i
  );
});

test('loading a skill is read-only, so it works in Plan mode too', async () => {
  const tool = createSkillTool({
    fileSystem: memoryFileSystem({ '.yisi/skills/deploy.md': DEPLOY }),
    skills: [{ name: 'deploy', description: 'Deploy.', path: '.yisi/skills/deploy.md' }]
  });
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) yield { type: 'toolCall', call: { id: 'c1', name: 'skill', input: { name: 'deploy' } } };
      else yield { type: 'textDelta', text: 'done' };
    }
  };
  const result = await new AgentToolLoop(provider, new ToolRegistry([tool]), new PermissionEngine()).run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'plan',
    () => undefined,
    SIGNAL
  );
  assert.equal(result.status, 'completed');
  const toolMessage = JSON.parse(requests.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(toolMessage.ok, true, 'reading a skill is not a state-changing action');
  assert.match(toolMessage.result.content, /Run the tests/);
});

// --- `/name` invocation ----------------------------------------------------

test('a leading /name is an invocation; anything else stays literal text', () => {
  assert.deepEqual(parseSkillInvocation('/deploy'), { name: 'deploy', remainder: '' });
  assert.deepEqual(parseSkillInvocation('  /Deploy to staging '), { name: 'deploy', remainder: 'to staging' });
  assert.deepEqual(parseSkillInvocation('/deploy\nsecond line'), { name: 'deploy', remainder: 'second line' });
  // A path is not a command, and a slash later in the message is just text.
  assert.equal(parseSkillInvocation('/usr/bin/env node'), undefined);
  assert.equal(parseSkillInvocation('please run /deploy'), undefined);
  assert.equal(parseSkillInvocation('/'), undefined);
  assert.equal(parseSkillInvocation('//deploy'), undefined);
});

test('the skill body is injected before the current user turn only', () => {
  const messages = [
    { role: 'system', content: 'role' },
    { role: 'user', content: 'earlier' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: '/deploy now' }
  ];
  const injected = withSkillContext(messages, { name: 'deploy', body: 'STEP ONE' });
  assert.equal(injected.length, 5);
  assert.equal(injected[3].role, 'system');
  assert.match(injected[3].content, /STEP ONE/);
  assert.equal(injected[4].content, '/deploy now', 'the user turn stays last');
  assert.equal(messages.length, 4, 'the caller array is not mutated');
});

test('the injected skill is framed as workspace content and bounded', () => {
  const message = buildSkillMessage({ name: 'deploy', body: 'x'.repeat(20_000) });
  assert.match(message, /workspace skill "deploy"/);
  assert.match(message, /cannot change\s+your tools, the permission rules or the mode briefing/);
  assert.ok(message.length < SKILL_BODY_CHARACTERS + 600);
});

// --- through ChatService ---------------------------------------------------

class MemoryRepository {
  async load() { return this.document && structuredClone(this.document); }
  async save(document) { this.document = structuredClone(document); }
}

async function chatHarness(skillInvoker, capture) {
  const sessions = new SessionService(new MemoryRepository(), { now: () => 1, createId: () => `id-${Math.random()}` });
  await sessions.initialize('workspace', []);
  await sessions.setModelSelection({ providerId: 'provider', modelId: 'model' });
  const provider = {
    id: 'provider',
    async listModels() { return ['model']; },
    async capabilities() { return { streaming: true }; },
    async *streamChat(request) {
      if (capture) capture.request = request;
      yield { text: 'ok' };
    }
  };
  const chat = new ChatService(
    sessions,
    { resolve: async () => provider },
    undefined,
    undefined,
    undefined,
    undefined,
    0.6,
    {},
    skillInvoker
  );
  return { chat, sessions };
}

test('`/name` sends the skill body for that turn but stores only what was typed', async () => {
  const capture = {};
  const { chat, sessions } = await chatHarness(
    { async load(name) { return name === 'deploy' ? { name, body: 'STEP ONE\nSTEP TWO' } : undefined; } },
    capture
  );

  await chat.send('/deploy to staging', () => {}, SIGNAL);

  const systems = capture.request.messages.filter(message => message.role === 'system');
  assert.equal(systems.length, 1, 'the skill rides in as one message');
  assert.match(systems[0].content, /STEP ONE/);
  assert.equal(capture.request.messages.at(-1).content, '/deploy to staging');

  // The session keeps the typed text: a 16k skill must not be replayed on every
  // later turn.
  const userItems = sessions.getActiveSession().items.filter(item => item.type === 'userMessage');
  assert.equal(userItems.length, 1);
  assert.equal(userItems[0].text, '/deploy to staging');
  assert.equal(JSON.stringify(sessions.getActiveSession()).includes('STEP ONE'), false);
});

test('an unknown /name is sent exactly as typed', async () => {
  const capture = {};
  const { chat } = await chatHarness({ async load() { return undefined; } }, capture);
  await chat.send('/nope do something', () => {}, SIGNAL);
  assert.equal(capture.request.messages.at(-1).content, '/nope do something');
  assert.equal(capture.request.messages.some(message => message.role === 'system'), false);
});

test('a skill that cannot be loaded does not cost the message', async () => {
  const capture = {};
  const { chat } = await chatHarness({ async load() { throw new Error('disk on fire'); } }, capture);
  await chat.send('/deploy now', () => {}, SIGNAL);
  assert.equal(capture.request.messages.at(-1).content, '/deploy now');
});

test('no skill invoker configured means the feature is simply absent', async () => {
  const capture = {};
  const { chat } = await chatHarness(undefined, capture);
  await chat.send('/deploy now', () => {}, SIGNAL);
  assert.equal(capture.request.messages.at(-1).content, '/deploy now');
});

test('the composition root wires discovery, the tool and the composer path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /new SkillService\(fileSystem\)\.discover\(\)/);
  assert.match(source, /createSkillTool\(\{ fileSystem, skills \}\)/);
  assert.match(source, /buildSkillCatalogueMessage\(skills\)/);
  assert.match(source, /async \(\) => skillCatalogue/);
  assert.match(source, /skills: \{ load: \(name, signal\) => skillService\.load\(name, signal\) \}/);
  assert.match(source, /agentWorkspace\.skills/);
});
