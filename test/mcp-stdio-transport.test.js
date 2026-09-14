// The process-backed MCP transport, driven against a real child process.
//
// The protocol layer is covered against an in-memory transport in
// test/mcp-client.test.js; this file is about the parts that only exist with a
// real process: spawn semantics (no shell), a real stdio round trip, cancellation
// of an in-flight call, and — the one that matters on Linux — that closing the
// transport actually reaps the child instead of leaving an orphan (docs/16,
// LNX-013).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { StdioMcpTransport } = require('../dist/yisi/infrastructure/mcp/stdioMcpTransport');
const { McpClient } = require('../dist/yisi/application/mcp/mcpClient');
const { McpServerService } = require('../dist/yisi/application/mcp/mcpServerService');

const SERVER = path.join(__dirname, 'fixtures', 'mcp-stdio-server.js');
const EXECUTABLE = process.execPath;

function startTransport(options = {}) {
  return new StdioMcpTransport({
    command: EXECUTABLE,
    args: [SERVER, ...(options.args ?? [])],
    ...(options.env ? { env: options.env } : {}),
    graceMs: 1_000
  });
}

async function connectedClient(options = {}) {
  const client = new McpClient(startTransport(options), { requestTimeoutMs: 5_000 });
  const identity = await client.connect();
  return { client, identity };
}

test('a real child process serves the protocol over stdio', async () => {
  const { client, identity } = await connectedClient();
  assert.equal(identity.name, 'fixture-server');
  assert.equal(identity.version, '9.9.9');

  const tools = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['echo', 'slow', 'fail']);

  const result = await client.callTool('echo', { text: 'hi' });
  assert.equal(result.content[0].text, 'echo:hi');
  assert.equal(result.isError, undefined);

  const failing = await client.callTool('fail', {});
  assert.equal(failing.isError, true);

  await client.close();
});

test('a tool error comes back as a protocol error, not a hang', async () => {
  const { client } = await connectedClient();
  await assert.rejects(client.callTool('nope', {}), /Unknown tool: nope/);
  await client.close();
});

test('cancelling a call in flight leaves the connection usable', async () => {
  const { client } = await connectedClient();
  const controller = new AbortController();
  const slow = client.callTool('slow', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(slow, error => error.name === 'AbortError');

  // The server is still there: cancellation must not tear the process down.
  const after = await client.callTool('echo', { text: 'still alive' });
  assert.equal(after.content[0].text, 'echo:still alive');
  await client.close();
});

test('closing the transport disconnects the client', async () => {
  const { client } = await connectedClient();
  await client.close();
  await assert.rejects(client.callTool('echo', { text: 'x' }), /closed/i);
});

test('closing reaps the child process instead of leaking an orphan', async () => {
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yisi-mcp-')), 'pid');
  const transport = startTransport({ env: { ...process.env, MCP_FIXTURE_MARKER: marker } });
  const client = new McpClient(transport, { requestTimeoutMs: 5_000 });
  await client.connect();
  await waitFor(() => fs.existsSync(marker), 3_000);
  const pid = Number(fs.readFileSync(marker, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 0, 'the fixture writes its pid while it runs');
  // Probe the pid directly rather than relying on the child's own exit handler:
  // on Windows a killed process is terminated without running its JS handlers,
  // so a cleanup-on-exit marker would fail here for the wrong reason.
  assert.equal(isAlive(pid), true, 'the server is running before the close');

  await client.close();
  await waitFor(() => !isAlive(pid), 3_000);
  assert.equal(isAlive(pid), false, 'the child must be gone after close()');
});

test('a server that dies on startup reports its stderr', async () => {
  const client = new McpClient(startTransport({ args: ['--die'] }), { requestTimeoutMs: 5_000 });
  await assert.rejects(client.connect(), error => /boom: the fixture cannot start/.test(error.message));
});

test('a command that does not exist fails to start instead of hanging', async () => {
  const transport = new StdioMcpTransport({ command: 'yisi-definitely-not-a-real-binary', args: [] });
  await assert.rejects(transport.start({ onMessage: () => undefined, onError: () => undefined, onClose: () => undefined }));
});

test('the server service drives the real process end to end', async () => {
  const service = new McpServerService(
    [{ name: 'fixture', command: EXECUTABLE, args: [SERVER] }],
    configuration =>
      new StdioMcpTransport({
        command: configuration.command,
        args: [...(configuration.args ?? [])],
        graceMs: 1_000
      }),
    { connectTimeoutMs: 10_000 }
  );

  const tools = await service.tools();
  assert.deepEqual(tools.map(tool => tool.id), ['mcp__fixture__echo', 'mcp__fixture__slow', 'mcp__fixture__fail']);
  // Unclassified MCP tools are conservative by default.
  assert.equal(tools[0].risk, 'environmentChange');
  assert.equal(tools[0].mutatesWorkspace, true);

  const statuses = await service.statuses();
  assert.equal(statuses[0].connected, true);
  assert.equal(statuses[0].serverName, 'fixture-server');

  const executed = await tools[0].execute({ text: 'through the bridge' }, {
    sessionId: 's',
    workspaceUri: 'file:///w',
    signal: new AbortController().signal
  });
  assert.equal(executed.server, 'fixture');
  assert.match(executed.output, /echo:through the bridge/);

  await service.dispose();
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/** Signal 0 probes for existence without delivering anything. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
