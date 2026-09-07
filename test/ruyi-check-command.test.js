const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'ui', 'chatViewProvider.ts'), 'utf8');

test('yisiAI.ruyi.check command is declared and wired', () => {
  assert.ok(pkg.contributes.commands.some(command => command.command === 'yisiAI.ruyi.check'), 'command declared');
  assert.match(index, /yisiAI\.ruyi\.check/);
  assert.match(index, /runRuyiCheck/);
  assert.match(index, /RuyiInspectionService/);
});

test('provider exposes a ruyi environment check surface', () => {
  assert.match(provider, /runRuyiCheck/);
  assert.match(provider, /ruyiInspect/);
});
