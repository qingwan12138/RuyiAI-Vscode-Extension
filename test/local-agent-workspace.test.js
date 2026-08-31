const test = require('node:test');
const assert = require('node:assert/strict');

const { selectLocalAgentWorkspace } = require('../dist/yisi/vscode/context/localAgentWorkspace');

const folder = (scheme, fsPath, value = `${scheme}://${fsPath}`) => ({
  uri: { scheme, fsPath, toString: () => value }
});

test('selects exactly one local file workspace', () => {
  assert.deepEqual(selectLocalAgentWorkspace([
    folder('file', '/workspace', 'file:///workspace')
  ]), { fsPath: '/workspace', uri: 'file:///workspace' });
});

test('rejects empty, multi-root, non-file, and blank local workspaces', () => {
  assert.equal(selectLocalAgentWorkspace([]), undefined);
  assert.equal(selectLocalAgentWorkspace([
    folder('file', '/a', 'file:///a'), folder('file', '/b', 'file:///b')
  ]), undefined);
  assert.equal(selectLocalAgentWorkspace([folder('vscode-remote', '/workspace')]), undefined);
  assert.equal(selectLocalAgentWorkspace([folder('file', '')]), undefined);
});
