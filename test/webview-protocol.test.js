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
    'addContext',
    'clearContext',
    'ruyiInspect'
  ]) {
    assert.deepEqual(parseWebviewMessage({ type }), { type });
  }
});

test('accepts every valid permission mode selection', () => {
  for (const value of ['plan', 'manual', 'acceptEdits', 'auto', 'fullAccess']) {
    assert.deepEqual(
      parseWebviewMessage({ type: 'permission.setMode', value }),
      { type: 'permission.setMode', value }
    );
  }
});

test('rejects invalid permission mode selections and the retired Quick Pick message', () => {
  for (const value of [
    { type: 'permission.setMode' },
    { type: 'permission.setMode', value: 'trusted' },
    { type: 'permission.setMode', value: '' },
    { type: 'permission.setMode', value: 'plan', extra: true },
    { type: 'selectPermission' }
  ]) {
    assert.throws(() => parseWebviewMessage(value), WebviewProtocolError);
  }
});

test('accepts validated model-control requests', () => {
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.selectModel', providerId: 'p1', modelId: 'm1' }),
    { type: 'modelControl.selectModel', providerId: 'p1', modelId: 'm1' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.setReasoning', value: 'high' }),
    { type: 'modelControl.setReasoning', value: 'high' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.setReasoning', value: 'auto' }),
    { type: 'modelControl.setReasoning', value: 'auto' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.setReasoning', value: 'xhigh' }),
    { type: 'modelControl.setReasoning', value: 'xhigh' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.setSpeed', value: 'fast' }),
    { type: 'modelControl.setSpeed', value: 'fast' }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.setTemperature', value: 0.7 }),
    { type: 'modelControl.setTemperature', value: 0.7 }
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'modelControl.setMaxTokens', value: 4096 }),
    { type: 'modelControl.setMaxTokens', value: 4096 }
  );
});

test('rejects malformed model-control requests', () => {
  for (const value of [
    { type: 'modelControl.selectModel', providerId: 'p1' },
    { type: 'modelControl.selectModel', providerId: '', modelId: 'm1' },
    { type: 'modelControl.setReasoning', value: 'extreme' },
    { type: 'modelControl.setSpeed', value: 'turbo' },
    { type: 'modelControl.setTemperature', value: 3 },
    { type: 'modelControl.setTemperature', value: '0.7' },
    { type: 'modelControl.setMaxTokens', value: 0 },
    { type: 'modelControl.setMaxTokens', value: 1000001 },
    { type: 'modelControl.setMaxTokens', value: 12.5 }
  ]) {
    assert.throws(() => parseWebviewMessage(value), WebviewProtocolError);
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
