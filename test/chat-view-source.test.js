const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
