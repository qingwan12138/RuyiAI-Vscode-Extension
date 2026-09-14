const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { Script } = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewHtml.ts'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewProvider.ts'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'webviewMarkdown.ts'), 'utf8');

test('streams provider content via textContent and renders safe Markdown after completion', () => {
  // The Markdown renderer lives in its own String.raw module (so regex
  // backslashes survive the template literal) and is injected into the webview.
  assert.match(source, /MARKDOWN_RENDERER_SOURCE/);
  assert.match(markdown, /function safeMarkdown\(/);
  assert.match(markdown, /function mdEscape\(/);
  assert.match(markdown, /String\.raw/);
  assert.equal(source.includes('document.body.innerHTML'), false);
  assert.match(source, /assistantStreamStarted/);
  assert.match(source, /assistantStreamDelta/);
  assert.match(source, /assistantStreamCompleted/);
  assert.match(source, /let isRunning = false/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'stop' \}\)/);
  assert.match(source, /contextState/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'clearContext' \}\)/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'removeAttachment', attachmentId: attachment\.id \}\)/);
});

test('run errors are rendered as a durable conversation bubble, not only the status row', () => {
  assert.match(source, /appendErrorBubble/);
  assert.match(source, /message error/);
  // A failure must drop a bare "Thinking…" bubble and finalize any partial text.
  assert.match(source, /streamedText/);
  assert.match(source, /sessionError/);
});

test('assistant and user bubbles expose a copy-to-clipboard button', () => {
  assert.match(source, /attachCopy/);
  assert.match(source, /message-copy/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /function copyText/);
  assert.match(source, /function fallbackCopy/);
  assert.match(source, /!\s*streaming\s*&&\s*\(role === 'assistant' \|\| role === 'user'\)/);
});

test('privileged tool approvals render as a sidebar card, not a window modal', () => {
  assert.match(source, /approvalHost/);
  assert.match(source, /renderApprovalCard/);
  assert.match(source, /toolApprovalResponse/);
  assert.match(source, /approval-card/);
  assert.match(source, /approval-button approve/);
  assert.match(source, /clearApprovals/);
  // A unified diff preview is rendered inside the approval card.
  assert.match(source, /renderApprovalDiff/);
  assert.match(source, /approval-diff-line/);
  assert.match(source, /request\.diff/);
  // The host resolves the webview's answer back into the approval broker.
  assert.match(provider, /ApprovalBroker/);
  assert.match(provider, /approvals\.resolve/);
  assert.match(provider, /attachPost/);
  assert.match(provider, /approvals\.cancelAll/);
});

test('agent tool activity is shown as step bubbles between the model text segments', () => {
  assert.match(source, /agentToolCall/);
  assert.match(source, /agentToolResult/);
  assert.match(source, /appendToolNode/);
  assert.match(source, /setToolResult/);
  assert.match(source, /function finalizeTextBubble/);
  assert.match(source, /message\.tool/);
  assert.match(source, /tool-result\.ok/);
});

test('Ruyi state popover is wired (toolbar button + live state)', () => {
  assert.match(source, /ruyiButton/);
  assert.match(source, /ruyiPopover/);
  assert.match(source, /ruyiInspect/);
  assert.match(source, /ruyiState/);
  assert.match(provider, /ruyiInspect/);
});

test('host surfaces run errors only after re-publishing session state', () => {
  assert.match(provider, /surfaceRunOutcome/);
  assert.match(provider, /status !== 'error'/);
  assert.match(provider, /publishState\(\)/);
});

test('never relies on native window.prompt or window.confirm for session actions', () => {
  assert.equal(source.includes('window.prompt'), false);
  assert.equal(source.includes('window.confirm'), false);
});

test('renames sessions through an inline input, not a browser dialog', () => {
  assert.match(source, /let editingSessionId = null/);
  assert.match(source, /session-edit-input/);
  assert.match(source, /aria-label', 'Session title'/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'renameSession', sessionId: summary\.id, title \}\)/);
  assert.match(source, /title\.length > 0/);
});

test('confirms deletion through an inline confirmation, not a browser dialog', () => {
  assert.match(source, /let confirmDeleteSessionId = null/);
  assert.match(source, /Delete this chat\?/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'deleteSession', sessionId: summary\.id, confirmed: true \}\)/);
});

test('stops rename/delete clicks from bubbling into session switching', () => {
  assert.match(source, /event\.stopPropagation\(\)/);
});

test('supports Enter to save and Escape to cancel inline rename', () => {
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /event\.key === 'Escape'/);
});

test('host reports specific rename/delete failures instead of the generic fallback', () => {
  assert.match(provider, /Failed to rename session\./);
  assert.match(provider, /Failed to delete session\./);
  assert.match(provider, /pendingContexts\.delete\(message\.sessionId\)/);
});

/** Extract a top-level `function name(...) { ... }` declaration by brace matching. */
function functionBody(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while reading function ${name}`);
}

/** Same, de-escaped the way the surrounding HTML template literal de-escapes it.
 *  The client script writes doubled backslashes so the browser receives single
 *  ones; only doubled ones may appear there (enforced by the scan test below),
 *  so this is an exact model of what the webview ends up running. */
function clientFunctionBody(text, name) {
  return functionBody(text, name).replace(/\\\\/g, '\\');
}

test('deleting or renaming a session leaves an open history panel open', () => {
  // #historyPanel, #welcome and #conversation are siblings sharing one content
  // area, so the panel's own `hidden` flag has to be the source of truth for the
  // view. Regression: every state refresh ran renderActiveSession ->
  // showHistory(false), so deleting (or renaming) a session closed a panel the
  // user had open — the refresh, not the user, decided the view.
  assert.equal(
    /showHistory\(false\)/.test(functionBody(source, 'renderActiveSession')),
    false,
    'a sessionState refresh must not close the history panel'
  );
  // The panel's visibility is owned by one place only, so nothing else can close it.
  assert.equal(
    (source.match(/historyPanel\.hidden\s*=/g) ?? []).length,
    1,
    'only showHistory() may assign historyPanel.hidden'
  );
  // Closing belongs to explicit navigation intents instead.
  assert.match(functionBody(source, 'submit'), /showHistory\(false\)/);
  // And a streaming run must not steal the content area back from the panel.
  assert.match(functionBody(source, 'appendMessage'), /if \(historyPanel\.hidden\)/);
});

test('the content area stays with an open history panel across a state refresh', () => {  // Drive the real renderView()/showHistory() logic lifted out of the embedded
  // webview script, against stub elements, instead of only pattern-matching it.
  function element() {
    const classes = new Set();
    return {
      hidden: true,
      style: {},
      classes,
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, on) => {
          if (on) classes.add(name);
          else classes.delete(name);
        }
      }
    };
  }

  const historyPanel = element();
  const welcome = element();
  const conversation = element();

  const build = new Function('historyPanel', 'welcome', 'conversation', `
    let viewMode = 'welcome';
    let activeSession;
    let renderHistoryCalls = 0;
    function renderHistory() { renderHistoryCalls += 1; }
    ${functionBody(source, 'renderView')}
    ${functionBody(source, 'showHistory')}
    return {
      renderView,
      showHistory,
      setState(next) { viewMode = next.viewMode; activeSession = next.session; },
      historyRenders() { return renderHistoryCalls; }
    };
  `);
  const view = build(historyPanel, welcome, conversation);

  // Closed panel on the welcome screen.
  view.renderView();
  assert.equal(historyPanel.hidden, true);
  assert.equal(welcome.style.display, '');
  assert.equal(conversation.classes.has('visible'), false);

  // The history button opens it while it is hidden (the existing toggle).
  view.showHistory(historyPanel.hidden);
  assert.equal(historyPanel.hidden, false);
  assert.equal(welcome.style.display, 'none', 'the panel owns the content area');
  assert.equal(conversation.classes.has('visible'), false);
  assert.equal(view.historyRenders(), 1, 'opening renders the list');

  // This is the reported bug: a refresh published by a delete (or a rename) used
  // to run showHistory(false) and close the panel. It must keep it open, and must
  // not let the conversation take the content area either.
  view.setState({ viewMode: 'conversation', session: { items: [{ text: 'hi', type: 'userMessage' }] } });
  view.renderView();
  assert.equal(historyPanel.hidden, false, 'a state refresh must not close the panel');
  assert.equal(welcome.style.display, 'none');
  assert.equal(conversation.classes.has('visible'), false, 'the conversation must stay behind the panel');

  // Closing is explicit, and then the conversation is revealed as usual.
  view.showHistory(false);
  assert.equal(historyPanel.hidden, true);
  assert.equal(welcome.style.display, 'none');
  assert.equal(conversation.classes.has('visible'), true);
});

test('going home leaves a fresh session, so the title matches the main screen', () => {
  // Reported: pressing the main-screen button kept the previous conversation's
  // name in the top bar while the screen looked like a fresh start. The main
  // screen now belongs to a fresh session, and an empty one is reused instead of
  // stacking up blank sessions.
  function build() {
    const posted = [];
    const focusCalls = [];
    const historyCalls = [];
    const factory = new Function('showHistory', 'input', 'vscode', `
      let viewMode = 'conversation';
      let activeSession;
      ${functionBody(source, 'goHome')}
      return {
        goHome,
        session(next) { activeSession = next; },
        mode() { return viewMode; }
      };
    `);
    return {
      view: factory(
        visible => historyCalls.push(visible),
        { focus: () => focusCalls.push(true) },
        { postMessage: message => posted.push(message) }
      ),
      posted,
      focusCalls,
      historyCalls
    };
  }

  // Leaving a conversation with content: start a new session.
  const withContent = build();
  withContent.view.session({ items: [{ type: 'userMessage', text: 'hi' }] });
  withContent.view.goHome();
  assert.equal(withContent.view.mode(), 'welcome');
  assert.deepEqual(withContent.posted, [{ type: 'newChat' }]);
  assert.deepEqual(withContent.historyCalls, [false], 'the history overlay is closed');
  assert.equal(withContent.focusCalls.length, 1, 'the composer takes focus');

  // An already-empty session is reused: no second blank session.
  const empty = build();
  empty.view.session({ items: [] });
  empty.view.goHome();
  assert.equal(empty.view.mode(), 'welcome');
  assert.deepEqual(empty.posted, [], 'no blank session is stacked on a blank one');

  // A missing session must not throw.
  const none = build();
  none.view.session(undefined);
  none.view.goHome();
  assert.deepEqual(none.posted, []);
});

test('the thinking row counts only the time actually spent thinking', () => {
  // Reported: the row should say how long the current think has taken. The real
  // logic is lifted out of the embedded script and driven with a fake clock,
  // because the interesting part is the accounting, not the text.
  let clock = 1_000_000;
  const timers = { intervals: 0, cleared: 0, tick: undefined };
  const build = new Function('setInterval', 'clearInterval', 'Date', `
    let reasoningNode;
    let streamedReasoning = '';
    let reasoningElapsed = 0;
    let reasoningStartedAt = 0;
    let reasoningTimer;
    ${clientFunctionBody(source, 'reasoningPreview')}
    ${clientFunctionBody(source, 'currentReasoningMs')}
    ${clientFunctionBody(source, 'formatDuration')}
    ${clientFunctionBody(source, 'reasoningLabel')}
    ${clientFunctionBody(source, 'updateReasoningNode')}
    ${clientFunctionBody(source, 'startReasoningTicker')}
    ${clientFunctionBody(source, 'openReasoningSegment')}
    ${clientFunctionBody(source, 'closeReasoningSegment')}
    ${clientFunctionBody(source, 'finalizeReasoning')}
    function row() {
      return { __header: { textContent: '' }, __body: { textContent: '' } };
    }
    return {
      row,
      // What the webview does when a reasoning delta arrives.
      think(node, text) {
        if (!reasoningNode) reasoningNode = node;
        openReasoningSegment();
        streamedReasoning += text;
        updateReasoningNode();
      },
      // What it does when the answer or a tool call ends the thinking.
      close() { closeReasoningSegment(); },
      finalize() { finalizeReasoning(); },
      hasTicker() { return Boolean(reasoningTimer); },
      label() { return reasoningLabel(); },
      format(ms) { return formatDuration(ms); },
      header(node) { return node.__header.textContent; }
    };
  `);

  const view = build(
    (fn, ms) => {
      timers.intervals += 1;
      timers.tick = fn;
      assert.equal(ms, 250, 'the ticker only exists to keep the number moving');
      return timers.intervals;
    },
    () => { timers.cleared += 1; timers.tick = undefined; },
    { now: () => clock }
  );

  // Nothing thought yet: the plain label, no invented duration.
  assert.equal(view.label(), '思考');

  // Thinking starts. The timer opens with the first delta and the row shows a
  // live elapsed value alongside the preview.
  const node = view.row();
  view.think(node, 'weighing options\nmore');
  assert.equal(view.hasTicker(), true, 'a live segment keeps a ticker running');
  assert.equal(timers.intervals, 1, 'one ticker per segment');
  clock += 3_400;
  timers.tick();
  assert.equal(view.header(node), '思考 · 3.4s · weighing options');

  // The answer starts: the segment closes and the value freezes at what was
  // actually spent thinking, instead of absorbing answer generation.
  clock += 1_600;
  view.close();
  assert.equal(view.hasTicker(), false, 'no interval may survive its segment');
  clock += 30_000;
  assert.equal(view.header(node), '思考 · 5.0s · weighing options', 'the frozen value must not move');

  // A tool call took 30s and the model thinks again: the second segment adds to
  // the first, so tool time is not charged to thinking.
  clock += 5_000;
  view.think(node, ' checking the file');
  assert.equal(view.hasTicker(), true, 'the second segment reopens the ticker');
  clock += 2_000;
  timers.tick();
  assert.equal(view.header(node), '思考 · 7.0s · weighing options', 'only thinking time accumulates');

  // The run ends: the ticker is gone, the row keeps its total, and the run-scoped
  // state is reset so the next run starts from zero.
  view.finalize();
  assert.equal(view.hasTicker(), false);
  assert.equal(timers.cleared, timers.intervals, 'every started ticker is cleared');
  assert.equal(view.header(node), '思考 · 7.0s · weighing options');
  assert.equal(view.label(), '思考', 'the next run starts counting from zero');

  // Closing twice (a completion event after a stop) must not double-count.
  view.close();
  assert.equal(timers.cleared, timers.intervals);

  // Duration formatting: sub-minute keeps one decimal, minutes are padded.
  assert.equal(view.format(0), '0.0s');
  assert.equal(view.format(1_000), '1.0s');
  assert.equal(view.format(59_940), '59.9s');
  assert.equal(view.format(60_000), '1m 00s');
  assert.equal(view.format(65_400), '1m 05s');
  assert.equal(view.format(3_600_000), '60m 00s');
  // Garbage in must not render as NaN in the row.
  assert.equal(view.format(Number.NaN), '0.0s');
  assert.equal(view.format(-5), '0.0s');
});

test('a session re-render drops the thinking row state and its ticker', () => {
  // renderActiveSession() rebuilds the conversation from persisted items, so the
  // transient thinking row disappears with it. Leaving the interval armed would
  // keep ticking against a detached node for the rest of the session.
  assert.match(functionBody(source, 'renderActiveSession'), /finalizeReasoning\(\)/);
  // Every run boundary that ends or restarts a run goes through the same reset.
  for (const handler of ['assistantStreamStarted', 'assistantStreamCompleted', 'sessionError', 'runStopped']) {
    assert.match(source, new RegExp(`message\\.type === '${handler}'[\\s\\S]{0,600}?finalizeReasoning\\(\\)`));
  }
  // Tool execution is not thinking: the tool step closes the segment.
  assert.match(
    source,
    /message\.type === 'agentToolCall'\)[\s\S]{0,400}?closeReasoningSegment\(\)/
  );
  assert.match(
    source,
    /message\.type === 'assistantStreamDelta'\)[\s\S]{0,400}?closeReasoningSegment\(\)/
  );
});

// ---------------------------------------------------------------------------
// The client script is embedded in an HTML template literal, so TypeScript
// consumes its backslashes before the browser ever sees them and `tsc` never
// parses it as JavaScript. These tests render the real artifact and parse what
// the webview actually receives.

/** Render the real view HTML. The compiled module imports "vscode", which only
 *  exists inside the extension host, so stub just the Uri surface it uses. */
function renderChatViewHtml() {
  const originalLoad = Module._load;
  const uri = value => ({ path: String(value), fsPath: String(value), toString: () => String(value) });
  Module._load = function patched(request, ...rest) {
    if (request === 'vscode') {
      return { Uri: { file: uri, joinPath: (base, ...parts) => uri([base, ...parts].join('/')) } };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const { createChatViewHtml } = require('../dist/yisi/ui/chatViewHtml');
    return createChatViewHtml(
      {
        cspSource: 'vscode-webview://test',
        asWebviewUri: value => ({ toString: () => 'vscode-webview://test/' + String(value) })
      },
      uri('/tmp/yisi-extension')
    );
  } finally {
    Module._load = originalLoad;
  }
}

function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) scripts.push(match[1]);
  return scripts;
}

test('every script the webview receives parses as JavaScript', () => {
  // Reported right after the thinking row shipped: "the UI is broken, clicking
  // anything does nothing". A syntax error in an inline script means the page
  // still renders but no listener is ever attached, so every click is dead.
  // tsc cannot see this: the script is text inside a template literal.
  const scripts = inlineScripts(renderChatViewHtml());
  assert.equal(scripts.length, 3, 'the view injects three inline scripts');
  scripts.forEach((body, index) => {
    try {
      new Script(body, { filename: `chatView-inline-${index + 1}.js` });
    } catch (error) {
      assert.fail(`inline script ${index + 1} does not parse (this kills the whole UI):\n${error.stack}`);
    }
  });
  // The last one is the client script that wires the UI; make sure this test is
  // looking at the script it thinks it is.
  assert.match(scripts[2], /message\.type === 'assistantReasoningDelta'/);
});

test('backslashes in the embedded client script survive the template literal', () => {
  // The silent half of the same trap: /\s+/ written singly arrives as /s+/,
  // which still parses and quietly collapses the letter "s" instead of
  // whitespace. So check what arrived, not how the source looks.
  const scripts = inlineScripts(renderChatViewHtml());
  const client = scripts[scripts.length - 1];
  assert.match(client, /split\(\/\\r\?\\n\/\)/, 'the CRLF split must arrive with its backslashes');
  assert.match(client, /replace\(\/\\s\+\/g, ' '\)/, 'the whitespace collapse must arrive intact');

  // And the rule that keeps it true for the whole region: inside a template
  // literal a single backslash can never reach the browser as written, so it
  // must always be doubled -- in comments too, where a lone \r would otherwise
  // inject a real line break into the emitted script.
  const start = source.lastIndexOf('<script nonce="${nonce}">');
  assert.notEqual(start, -1, 'the embedded client script was not found');
  const end = source.indexOf('</script>', start);
  assert.notEqual(end, -1, 'the embedded client script is not closed');
  const region = source.slice(start, end);
  const violations = [];
  for (let index = 0; index < region.length; index += 1) {
    if (region[index] !== '\\') continue;
    if (region[index + 1] === '\\') {
      index += 1;
      continue;
    }
    violations.push(`line ${region.slice(0, index).split('\n').length}: \\${region[index + 1]}`);
  }
  assert.deepEqual(violations, [], 'every backslash in the embedded client script must be doubled');
});
