const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewHtml.ts'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewProvider.ts'), 'utf8');

test('streams provider content via textContent and renders safe Markdown after completion', () => {
  // Assistant output is rendered through an escape-then-transform Markdown path
  // (headings/bold/tables/code blocks), never a raw HTML sink.
  assert.match(source, /function safeMarkdown\(/);
  assert.match(source, /function renderMessageBody\(/);
  assert.match(source, /function mdEscape\(/);
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
