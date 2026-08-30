const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WebviewProtocolError,
  parseWebviewMessage
} = require('../dist/yisi/ui/webviewProtocol');

test('accepts every payload-free Webview request', () => {
  for (const type of [
    'ready',
    'newChat',
    'openSettings',
    'stop',
    'continue',
    'selectModel',
    'selectPermission',
    'addContext'
  ]) {
    assert.deepEqual(parseWebviewMessage({ type }), { type });
  }
});

test('accepts validated session and message requests', () => {
  assert.deepEqual(
    parseWebviewMessage({ type: 'sendMessage', text: 'hello' }),
    { type: 'sendMessage', text: 'hello' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'switchSession', sessionId: 'session-1' }),
    { type: 'switchSession', sessionId: 'session-1' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'renameSession', sessionId: 'session-1', title: 'Renamed' }),
    { type: 'renameSession', sessionId: 'session-1', title: 'Renamed' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'deleteSession', sessionId: 'session-1', confirmed: true }),
    { type: 'deleteSession', sessionId: 'session-1', confirmed: true }
  );
});

test('rejects missing, blank, or false mutation fields', () => {
  for (const value of [
    { type: 'sendMessage', text: '   ' },
    { type: 'switchSession' },
    { type: 'renameSession', sessionId: 'session-1', title: '' },
    { type: 'deleteSession', sessionId: 'session-1', confirmed: false }
  ]) {
    assert.throws(
      () => parseWebviewMessage(value),
      error => error instanceof WebviewProtocolError && /Invalid Webview message/.test(error.message)
    );
  }
});

test('rejects arrays, unknown message types, and unexpected fields', () => {
  for (const value of [
    [],
    { type: 'unknown' },
    { type: 'newChat', injected: true },
    { type: 'sendMessage', text: 'hello', extra: 'field' }
  ]) {
    assert.throws(() => parseWebviewMessage(value), WebviewProtocolError);
  }
});
