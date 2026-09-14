// Parsing of the `yisiAI.mcpServers` setting.
//
// The setting is user-authored JSON, and a malformed entry decides what local
// process gets spawned, so nothing here is coerced: an entry is either fully
// valid or rejected with a reason the caller logs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseMcpServerConfigurations } = require('../dist/yisi/application/mcp/mcpConfiguration');

test('an absent or empty setting configures no servers', () => {
  assert.deepEqual(parseMcpServerConfigurations(undefined), { servers: [], rejected: [] });
  assert.deepEqual(parseMcpServerConfigurations([]), { servers: [], rejected: [] });
});

test('a non-array value is rejected with a reason, not coerced', () => {
  const result = parseMcpServerConfigurations({ name: 'sneaky', command: 'node' });
  assert.deepEqual(result.servers, []);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /array/i);
});

test('a complete entry is parsed as configured', () => {
  const result = parseMcpServerConfigurations([
    {
      name: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      enabled: true,
      toolRisks: { list_issues: 'readOnly', create_issue: 'workspaceWrite' }
    }
  ]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.servers, [
    {
      name: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      toolRisks: { list_issues: 'readOnly', create_issue: 'workspaceWrite' }
    }
  ]);
});

test('entries missing a usable name or command are rejected', () => {
  const cases = [
    {},
    { name: '', command: 'node' },
    { name: '   ', command: 'node' },
    { name: 'ok' },
    { name: 'ok', command: '   ' },
    { name: 'ok', command: 'node\0evil' },
    { name: 'x'.repeat(65), command: 'node' },
    'not an object',
    null
  ];
  for (const entry of cases) {
    const result = parseMcpServerConfigurations([entry]);
    assert.deepEqual(result.servers, [], `${JSON.stringify(entry)} must not configure a server`);
    assert.equal(result.rejected.length, 1, `${JSON.stringify(entry)} must be reported`);
  }
});

test('malformed args and flags are rejected instead of guessed at', () => {
  assert.equal(parseMcpServerConfigurations([{ name: 'a', command: 'node', args: 'x' }]).rejected.length, 1);
  assert.equal(parseMcpServerConfigurations([{ name: 'a', command: 'node', args: ['ok', 2] }]).rejected.length, 1);
  assert.equal(parseMcpServerConfigurations([{ name: 'a', command: 'node', enabled: 'yes' }]).rejected.length, 1);

  const disabled = parseMcpServerConfigurations([{ name: 'a', command: 'node', enabled: false, args: [] }]);
  assert.deepEqual(disabled.servers, [{ name: 'a', command: 'node', enabled: false }]);
});

test('a risk the agent loop would refuse outright cannot be declared', () => {
  // destructive / credentialSensitive stay outside the loop's bounded scope: the run
  // would die with "outside the bounded Agent tool scope" instead of asking.
  for (const risk of ['destructive', 'credentialSensitive', 'root']) {
    const result = parseMcpServerConfigurations([
      { name: 'a', command: 'node', toolRisks: { thing: risk } }
    ]);
    assert.deepEqual(result.servers, [], `${risk} must not be declarable`);
    assert.match(result.rejected[0].reason, /readOnly, workspaceWrite, processExec, environmentChange, network/);
  }
});

test('network is declarable, so a search tool says what it does', () => {
  // It used to have to masquerade as `readOnly`, which let network egress pass
  // silently in every mode including Plan. Declaring it means the engine decides
  // and the approval card can name it.
  const result = parseMcpServerConfigurations([
    { name: 'web', command: 'node', toolRisks: { search: 'network' } }
  ]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.servers[0].toolRisks, { search: 'network' });
});

test('two servers cannot share a name, because their tool ids would collide', () => {
  const result = parseMcpServerConfigurations([
    { name: 'github', command: 'node' },
    { name: 'GitHub', command: 'node' }
  ]);
  assert.equal(result.servers.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /Duplicate/);
});

test('one bad entry does not discard the good ones', () => {
  const result = parseMcpServerConfigurations([
    { name: 'good', command: 'node' },
    { name: 'bad', args: ['no', 'command'] },
    { name: 'also-good', command: 'node' }
  ]);
  assert.deepEqual(result.servers.map(server => server.name), ['good', 'also-good']);
  assert.deepEqual(result.rejected, [{ index: 1, reason: 'A non-empty "command" is required (an executable, not a shell line).' }]);
});

test('the composition root wires MCP into the agent tool set and disposes it', () => {
  // index.ts imports vscode, so the wiring is guarded at the source level.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /createMcpServerService\(context\)/);
  assert.match(source, /new McpServerService\(/);
  assert.match(source, /new StdioMcpTransport\(/);
  assert.match(source, /mcpServers\.tools\(\)/);
  assert.match(source, /\.\.\.mcpTools/, 'the bridged tools must reach the registry');
  assert.match(source, /mcpServers\?\.dispose\(\)/, 'child processes must not outlive the extension');
  assert.match(source, /getConfiguration\('yisiAI'\)\.get<unknown>\('mcpServers'\)/);
});

test('the setting is declared in the extension manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const property = manifest.contributes.configuration.properties['yisiAI.mcpServers'];
  assert.ok(property, 'yisiAI.mcpServers must be declared');
  assert.equal(property.type, 'array');
  assert.ok(property.items, 'the entry shape must be documented for the settings UI');
  assert.deepEqual(property.items.required, ['name', 'command']);
});
