// The agent's process trace: the model's thinking, and expandable tool-step detail.
//
// Reported by the user: they wanted to see the process the way the DeepSeek
// Harness shows it - thinking blocks, tool calls, each clickable for detail.
// Thinking was previously dropped at the transport boundary, so this covers the
// whole path from a provider event to the webview.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');
const { ChatRunCoordinator } = require('../dist/yisi/ui/chatRunCoordinator');

const context = signal => ({ sessionId: 'session-1', workspaceUri: 'file:///workspace', signal });

test('the loop forwards thinking as its own delta kind, outside the conversation', async () => {
  const seen = [];
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      yield { type: 'reasoningDelta', text: 'step one. ' };
      yield { type: 'reasoningDelta', text: 'step two.' };
      yield { type: 'textDelta', text: 'the answer' };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry([]), new PermissionEngine());
  const signal = new AbortController().signal;

  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    context(signal),
    'manual',
    (text, kind) => seen.push([text, kind || 'text']),
    signal
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'the answer');
  // Thinking arrives under its own kind, and before the answer text (which the
  // loop only emits once the round's stream has ended).
  assert.deepEqual(seen.map(entry => entry[1]), ['reasoning', 'reasoning', 'text']);
  assert.equal(seen[0][0], 'step one. ');
  // It is a UI trace, never conversation content sent back to the model.
  assert.equal(JSON.stringify(requests[0].messages).includes('step one'), false);
});

test('tool step results carry a fuller detail than the collapsed summary', async () => {
  const events = [];
  const long = 'x'.repeat(4_000);
  const tool = {
    id: 'read_file',
    description: 'Read a file',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ text: long })
  };
  const provider = {
    async *streamAgent(request) {
      const last = request.messages[request.messages.length - 1];
      if (last.role !== 'tool') {
        yield { type: 'toolCall', call: { id: 'c1', name: 'read_file', input: {} } };
        return;
      }
      yield { type: 'textDelta', text: 'done' };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry([tool]), new PermissionEngine());
  const signal = new AbortController().signal;

  await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'read it' }] },
    context(signal),
    'manual',
    () => undefined,
    signal,
    event => events.push(event)
  );

  const result = events.find(event => event.type === 'toolResult');
  assert.ok(result, 'a tool result event must be emitted');
  assert.ok(result.summary.length <= 600, 'the collapsed row stays one line');
  assert.ok(result.detail.length > result.summary.length, 'the expanded body carries more');
  assert.ok(result.detail.length <= 8_000);
  assert.equal(result.detail.includes(long.slice(0, 100)), true);
});

test('a refusal step also carries detail, so a refusal can be inspected', async () => {
  const events = [];
  const tool = {
    id: 'replace_text',
    description: 'Edit a file',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ replacements: 1 })
  };
  const provider = {
    async *streamAgent() {
      yield { type: 'toolCall', call: { id: 'c1', name: 'replace_text', input: { path: 'a' } } };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry([tool]), new PermissionEngine(), { maxConsecutiveDenials: 1 });
  const signal = new AbortController().signal;

  await loop.run({ model: 'm', messages: [{ role: 'user', content: 'edit' }] }, context(signal), 'plan', () => undefined, signal, event => events.push(event));

  const refusal = events.find(event => event.type === 'toolResult');
  assert.equal(refusal.outcome, 'failed');
  assert.match(refusal.detail, /Plan mode|BLOCKED|refus/i);
});

test('the coordinator keeps thinking out of the assistant text', async () => {
  const events = [];
  const chat = {
    async send(_text, onDelta) {
      onDelta('weighing options ', 'reasoning');
      onDelta('final ');
      onDelta('answer');
    }
  };
  const coordinator = new ChatRunCoordinator(chat, event => events.push(event));

  const outcome = await coordinator.start('do something');

  assert.equal(outcome.status, 'completed');
  assert.deepEqual(
    events.filter(event => event.type === 'assistantReasoningDelta'),
    [{ type: 'assistantReasoningDelta', text: 'weighing options ' }]
  );
  assert.deepEqual(
    events.filter(event => event.type === 'assistantStreamDelta'),
    [{ type: 'assistantStreamDelta', text: 'final ' }, { type: 'assistantStreamDelta', text: 'answer' }]
  );
});

test('the webview renders thinking and tool steps as collapsible rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewHtml.ts'), 'utf8');
  // Thinking is its own streaming block, inserted above the answer it produced.
  assert.match(source, /message\.type === 'assistantReasoningDelta'/);
  assert.match(source, /function appendReasoningNode\(\)/);
  assert.match(source, /function finalizeReasoning\(\)/);
  assert.match(source, /conversation\.insertBefore\(node, transientAssistant\)/);
  // Both kinds of step are <details>, so a click reveals the detail.
  assert.match(source, /createElement\('details'\)/);
  assert.match(source, /node\.className = 'message tool'/);
  assert.match(source, /node\.className = 'message reasoning'/);
  assert.match(source, /message\.detail \|\| message\.summary/);
  // The trace is transient: it is not written into the session or the model's
  // conversation, so a state refresh rebuilds the view without it.
  assert.equal(source.includes('streamedReasoning'), true);
  assert.equal(/postMessage\(\{[^}]*reason/i.test(source), false, 'reasoning must not be sent back to the host');
});

test('the thinking row stays collapsed and previews the thinking live', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewHtml.ts'), 'utf8');
  // Reported: it must read like a single dynamic line, not an expanded block.
  assert.equal(/node\.open = true/.test(source), false, 'no step may auto-expand');
  assert.match(source, /node\.open = false/);
  assert.match(source, /function reasoningPreview\(\)/);
  assert.match(source, /function updateReasoningNode\(\)/);
  // The label is "思考 · <elapsed> · <preview>" and is rebuilt on every delta.
  assert.match(source, /const parts = \['思考'\]/);
  assert.match(source, /parts\.join\(' · '\)/);
  assert.match(source, /updateReasoningNode\(\);/);
  // Elapsed thinking time is shown on the row and kept moving while nothing
  // streams, so a slow think does not read as a stall.
  assert.match(source, /function formatDuration\(ms\)/);
  assert.match(source, /function startReasoningTicker\(\)/);
  assert.match(source, /clearInterval\(reasoningTimer\)/);
  assert.match(source, /message\.type === 'assistantReasoningDelta'\)[\s\S]{0,400}?openReasoningSegment\(\)/);
  // The preview is the first non-empty line, whitespace-collapsed. The
  // backslashes are doubled because the script sits inside an HTML template
  // literal -- written singly they reach the browser as real line breaks and the
  // client script stops parsing (the whole UI goes dead). What the browser
  // actually receives is asserted by the render test in chat-view-source.
  assert.match(source, /split\(\/\\\\r\?\\\\n\/\)\.find\(line => line\.trim\(\)\.length > 0\)/);
  assert.match(source, /replace\(\/\\\\s\+\/g, ' '\)/);
  // One visual line: clipped with an ellipsis rather than wrapped.
  assert.match(source, /\.message\.reasoning > summary/);
  assert.match(source, /text-overflow: ellipsis/);
  assert.match(source, /white-space: nowrap/);
});
