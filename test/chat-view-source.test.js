const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewHtml.ts'), 'utf8');

test('renders streamed provider content through textContent and explicit run-state events', () => {
  assert.equal(source.includes('.innerHTML'), false);
  assert.match(source, /assistantStreamStarted/);
  assert.match(source, /assistantStreamDelta/);
  assert.match(source, /assistantStreamCompleted/);
  assert.match(source, /let isRunning = false/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'stop' \}\)/);
});
