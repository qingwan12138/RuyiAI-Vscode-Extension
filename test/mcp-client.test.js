// MCP client, tool bridge and server service.
//
// These run against an in-memory transport so the protocol layer is verifiable
// without spawning anything; test/mcp-stdio-transport.test.js covers the real
// process-backed transport.
//
// The security-relevant properties under test:
//   1. A bridged tool can never shadow a built-in tool name.
//   2. An unclassified MCP tool is conservative: Plan refuses it, other modes
//      ask, and only Full Access runs it unattended.
//   3. The (risk, mutatesWorkspace) pair handed to the loop is one the loop
//      admits, because a mismatch becomes "outside the bounded tool scope"
//      instead of a permission decision.
//   4. A broken server degrades to zero tools and a status — never a failed run.

const test = require('node:test');
const assert = require('node:assert/strict');

const { McpClient, McpProtocolError, McpTimeoutError } = require('../dist/yisi/application/mcp/mcpClient');
const {
  MCP_DEFAULT_RISK,
  MCP_TOOL_PREFIX,
  createMcpTools,
  isMcpToolId,
  mcpToolId,
  mcpToolRisk,
  renderMcpCallResult
} = require('../dist/yisi/application/mcp/mcpToolBridge');
const { McpServerService } = require('../dist/yisi/application/mcp/mcpServerService');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

/** An in-memory transport: `handler(message, reply)` plays the server. */
function memoryTransport(handler) {
  const events = { onMessage: () => undefined, onError: () => undefined, onClose: () => undefined };
  const sent = [];
  return {
    sent,
    transport: {
      async start(incoming) {
        Object.assign(events, incoming);
      },
      async send(message) {
        sent.push(message);
        if (handler) await handler(message, reply => events.onMessage(reply));
      },
      async close() {
        events.onClose('closed by the client');
      }
    },
    reply: message => events.onMessage(message),
    fail: error => events.onError(error),
    closeFromServer: reason => events.onClose(reason)
  };
}

function mcpServer({ tools = [], callResult, onCall } = {}) {
  return async (message, reply) => {
    switch (message.method) {
      case 'initialize':
        reply({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'fake-server', version: '1.2.3' }
          }
        });
        return;
      case 'tools/list':
        reply({ jsonrpc: '2.0', id: message.id, result: { tools } });
        return;
      case 'tools/call':
        if (onCall) await onCall(message);
        reply({ jsonrpc: '2.0', id: message.id, result: callResult ?? { content: [{ type: 'text', text: 'ok' }] } });
        return;
      default:
        return; // notifications (e.g. notifications/initialized) get no reply
    }
  };
}

test('connect performs the handshake and reports the server identity', async () => {
  const fake = memoryTransport(mcpServer());
  const client = new McpClient(fake.transport);
  const identity = await client.connect();

  assert.deepEqual(identity, { name: 'fake-server', version: '1.2.3', protocolVersion: '2025-06-18' });
  const initialize = fake.sent.find(message => message.method === 'initialize');
  assert.equal(initialize.jsonrpc, '2.0');
  assert.equal(typeof initialize.id, 'number');
  assert.ok(initialize.params.clientInfo.name, 'the server must be told who is calling');
  // The spec requires the initialized notification before any other request.
  assert.deepEqual(fake.sent[1], { jsonrpc: '2.0', method: 'notifications/initialized' });
});

test('listTools parses definitions, skips malformed entries and follows cursors', async () => {
  const pages = [
    { tools: [{ name: 'alpha', description: 'A', inputSchema: { type: 'object' } }, { name: '' }, 42], nextCursor: 'p2' },
    { tools: [{ name: 'beta' }] }
  ];
  let page = 0;
  const fake = memoryTransport(async (message, reply) => {
    if (message.method === 'initialize') return reply({ jsonrpc: '2.0', id: message.id, result: {} });
    if (message.method === 'tools/list') return reply({ jsonrpc: '2.0', id: message.id, result: pages[page++] });
  });
  const client = new McpClient(fake.transport);
  await client.connect();
  const tools = await client.listTools();

  assert.deepEqual(tools, [
    { name: 'alpha', description: 'A', inputSchema: { type: 'object' } },
    { name: 'beta' }
  ]);
  assert.equal(fake.sent.filter(message => message.method === 'tools/list').length, 2);
  assert.equal(fake.sent.at(-1).params.cursor, 'p2', 'the cursor has to be sent back');
});

test('listTools is bounded when a server keeps handing out cursors', async () => {
  const fake = memoryTransport(async (message, reply) => {
    if (message.method === 'initialize') return reply({ jsonrpc: '2.0', id: message.id, result: {} });
    if (message.method === 'tools/list') {
      return reply({ jsonrpc: '2.0', id: message.id, result: { tools: [], nextCursor: 'again' } });
    }
  });
  const client = new McpClient(fake.transport, { maxToolPages: 3 });
  await client.connect();
  await client.listTools();
  assert.equal(fake.sent.filter(message => message.method === 'tools/list').length, 3);
});

test('callTool forwards the arguments and parses content and isError', async () => {
  let received;
  const fake = memoryTransport(
    mcpServer({
      callResult: { content: [{ type: 'text', text: 'hello' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }], isError: true },
      onCall: message => {
        received = message.params;
      }
    })
  );
  const client = new McpClient(fake.transport);
  await client.connect();
  const result = await client.callTool('read_thing', { path: 'a.txt' });

  assert.deepEqual(received, { name: 'read_thing', arguments: { path: 'a.txt' } });
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].text, 'hello');
});

test('a JSON-RPC error becomes a protocol error carrying the server message', async () => {
  const fake = memoryTransport(async (message, reply) => {
    if (message.method === 'initialize') return reply({ jsonrpc: '2.0', id: message.id, result: {} });
    reply({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'bad arguments' } });
  });
  const client = new McpClient(fake.transport);
  await client.connect();
  await assert.rejects(
    client.callTool('x', {}),
    error => error instanceof McpProtocolError && /bad arguments/.test(error.message) && /-32602/.test(error.message)
  );
});

test('a server-initiated request is answered, not ignored', async () => {
  const fake = memoryTransport(mcpServer());
  const client = new McpClient(fake.transport);
  await client.connect();
  // e.g. a sampling/roots request: a server waiting for an answer looks hung.
  fake.reply({ jsonrpc: '2.0', id: 99, method: 'sampling/createMessage', params: {} });

  const answer = fake.sent.find(message => message.id === 99);
  assert.ok(answer, 'the client must respond to a server request');
  assert.equal(answer.error.code, -32601);
  assert.match(answer.error.message, /sampling\/createMessage/);
});

test('a request that never gets an answer times out', async () => {
  const fake = memoryTransport(async message => {
    if (message.method === 'initialize') fake.reply({ jsonrpc: '2.0', id: message.id, result: {} });
    // tools/list is deliberately never answered.
  });
  const client = new McpClient(fake.transport, { requestTimeoutMs: 30 });
  await client.connect();
  await assert.rejects(client.listTools(), McpTimeoutError);
});

test('a late answer to a timed-out request is ignored', async () => {
  const fake = memoryTransport(async message => {
    if (message.method === 'initialize') fake.reply({ jsonrpc: '2.0', id: message.id, result: {} });
    if (message.method === 'tools/list') {
      setTimeout(() => fake.reply({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'late' }] } }), 60);
    }
  });
  const client = new McpClient(fake.transport, { requestTimeoutMs: 20 });
  await client.connect();
  await assert.rejects(client.listTools(), McpTimeoutError);
  await new Promise(resolve => setTimeout(resolve, 80)); // the late answer must not throw
});

test('cancelling a request rejects it with an abort error', async () => {
  const fake = memoryTransport(async message => {
    if (message.method === 'initialize') fake.reply({ jsonrpc: '2.0', id: message.id, result: {} });
  });
  const client = new McpClient(fake.transport);
  await client.connect();
  const controller = new AbortController();
  const pending = client.listTools(controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('a server disconnect rejects everything in flight', async () => {
  let listed = false;
  const fake = memoryTransport(async message => {
    if (message.method === 'initialize') fake.reply({ jsonrpc: '2.0', id: message.id, result: {} });
    if (message.method === 'tools/list') listed = true; // never answered
  });
  const client = new McpClient(fake.transport);
  await client.connect();
  const pending = client.listTools();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(listed, true);
  fake.closeFromServer('The MCP server exited (code 1).');
  await assert.rejects(pending, error => error instanceof McpProtocolError && /exited/.test(error.message));
});

test('bridged tool ids are namespaced and never shadow a built-in', () => {
  assert.equal(mcpToolId('GitHub', 'list.issues'), 'mcp__github__list_issues');
  assert.equal(isMcpToolId('mcp__github__list_issues'), true);
  assert.equal(isMcpToolId('run_command'), false);
  // The prefix is reserved: nothing in the built-in tool set uses it.
  assert.equal(MCP_TOOL_PREFIX, 'mcp__');
});

test('an unclassified MCP tool is conservative by default', () => {
  assert.equal(mcpToolRisk(undefined).risk, MCP_DEFAULT_RISK);
  assert.equal(mcpToolRisk(undefined).mutatesWorkspace, true);
  assert.equal(mcpToolRisk('nonsense').risk, MCP_DEFAULT_RISK, 'an unknown declaration must not loosen anything');
  assert.deepEqual(mcpToolRisk('readOnly'), { risk: 'readOnly', mutatesWorkspace: false });
  assert.deepEqual(mcpToolRisk('workspaceWrite'), { risk: 'workspaceWrite', mutatesWorkspace: true });
});

test('every declared risk maps to a pair the loop admits', () => {
  // The loop admits exactly four (risk, mutatesWorkspace) combinations and
  // refuses anything else as "outside the bounded Agent tool scope" — which would
  // turn a permission decision into a dead run.
  const admitted = [
    ['readOnly', false],
    ['workspaceWrite', true],
    ['processExec', true],
    ['environmentChange', true],
    // Its own axis: a search does not write, and the engine still gates it.
    ['network', false]
  ];
  const produced = ['readOnly', 'workspaceWrite', 'processExec', 'environmentChange', 'network', undefined].map(risk => {
    const resolved = mcpToolRisk(risk);
    return [resolved.risk, resolved.mutatesWorkspace];
  });
  for (const pair of produced) {
    assert.ok(
      admitted.some(([risk, mutates]) => risk === pair[0] && mutates === pair[1]),
      `${pair[0]}/${pair[1]} is outside the loop's bounded scope`
    );
  }
});

test('non-text content is described instead of silently dropped', () => {
  const rendered = renderMcpCallResult({
    content: [{ type: 'text', text: 'summary' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }]
  });
  assert.match(rendered.text, /summary/);
  assert.match(rendered.text, /image\/png/);
  assert.match(rendered.text, /not shown/);
  assert.equal(rendered.isError, false);

  const empty = renderMcpCallResult({ content: [] });
  assert.match(empty.text, /returned no content/);

  const failing = renderMcpCallResult({ content: [{ type: 'text', text: 'boom' }], isError: true });
  assert.equal(failing.isError, true);
});

test('a huge MCP result is bounded with a visible marker', () => {
  const huge = 'z'.repeat(20_000);
  const rendered = renderMcpCallResult({ content: [{ type: 'text', text: huge }] });
  assert.equal(rendered.truncated, true);
  assert.match(rendered.text, /characters omitted/);
  assert.ok(rendered.text.length < huge.length);
});

// --- end-to-end through the real agent loop -------------------------------

function scriptedProvider(requests) {
  return {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: 'mcp__demo__do_thing', input: { value: 1 } } };
      } else {
        yield { type: 'textDelta', text: 'done' };
      }
    }
  };
}

async function runWithMcpTool({ mode, declaredRisk, confirmations }) {
  const calls = [];
  const fake = memoryTransport(mcpServer({ callResult: { content: [{ type: 'text', text: 'mcp says hi' }] } }));
  const client = new McpClient(fake.transport);
  await client.connect();
  const tools = createMcpTools({
    serverName: 'demo',
    definitions: [{ name: 'do_thing', description: 'Does a thing.', inputSchema: { type: 'object' } }],
    client: {
      callTool: async (name, args, options) => {
        calls.push({ name, args, signal: options?.signal });
        return client.callTool(name, args, options);
      }
    },
    ...(declaredRisk ? { toolRisks: { do_thing: declaredRisk } } : {})
  });
  const requests = [];
  const signal = new AbortController().signal;
  const loop = new AgentToolLoop(
    scriptedProvider(requests),
    new ToolRegistry(tools),
    new PermissionEngine(),
    {},
    confirmations
  );
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'do it' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal },
    mode,
    () => undefined,
    signal
  );
  const toolMessage = requests.at(-1).messages.find(message => message.role === 'tool');
  return { result, calls, toolMessage: toolMessage ? JSON.parse(toolMessage.content) : undefined, requests };
}

test('Plan mode refuses an unclassified MCP tool instead of running it', async () => {
  const { result, calls, toolMessage } = await runWithMcpTool({ mode: 'plan' });
  assert.equal(result.status, 'completed', 'a refusal is a tool outcome, not a dead run');
  assert.equal(calls.length, 0, 'the server must never be called');
  assert.equal(toolMessage.denied, true);
  assert.equal(toolMessage.reason, 'policy');
});

test('Manual mode asks before calling an unclassified MCP tool', async () => {
  const approvals = [];
  const approvalsPort = {
    async confirm(request) {
      approvals.push(request);
      return true;
    }
  };
  const { result, calls, toolMessage } = await runWithMcpTool({ mode: 'manual', confirmations: approvalsPort });
  assert.equal(result.status, 'completed');
  assert.equal(approvals.length, 1, 'the user is asked exactly once');
  assert.equal(approvals[0].toolId, 'mcp__demo__do_thing');
  assert.equal(calls.length, 1, 'the call runs after approval');
  assert.equal(calls[0].name, 'do_thing', 'the real MCP tool name is used, not the namespaced id');
  // The loop serialises a success as { ok, result, truncated }.
  assert.match(toolMessage.result.output, /mcp says hi/);
  assert.equal(toolMessage.result.server, 'demo');
  assert.equal(toolMessage.result.tool, 'do_thing');
});

test('declining the approval never reaches the server', async () => {
  const { calls, toolMessage } = await runWithMcpTool({
    mode: 'manual',
    confirmations: { async confirm() { return false; } }
  });
  assert.equal(calls.length, 0);
  assert.equal(toolMessage.reason, 'user');
});

test('Full Access runs an unclassified MCP tool without asking', async () => {
  const { calls, result } = await runWithMcpTool({ mode: 'fullAccess' });
  assert.equal(result.status, 'completed');
  assert.equal(calls.length, 1);
});

test('a user-declared read-only MCP tool runs without approval', async () => {
  // The declaration is the user's: they reviewed the server. It is also the only
  // way an MCP tool can run inside Plan mode.
  const { calls, toolMessage } = await runWithMcpTool({ mode: 'plan', declaredRisk: 'readOnly' });
  assert.equal(calls.length, 1);
  assert.equal(toolMessage.ok, true);
});

// --- server service -------------------------------------------------------

function serverService(configurations, { connectTimeoutMs } = {}) {
  const transports = [];
  const service = new McpServerService(
    configurations,
    () => {
      const fake = memoryTransport(
        mcpServer({ tools: [{ name: 't1', description: 'T1' }, { name: 't2', description: 'T2' }] })
      );
      transports.push(fake);
      return fake.transport;
    },
    { ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}) }
  );
  return { service, transports };
}

test('the service bridges every enabled server and reports statuses', async () => {
  const { service } = serverService([
    { name: 'one', command: 'node', args: ['server.js'] },
    { name: 'two', command: 'node', args: ['server.js'], toolRisks: { t1: 'readOnly' } }
  ]);
  const tools = await service.tools();
  assert.deepEqual(tools.map(tool => tool.id), ['mcp__one__t1', 'mcp__one__t2', 'mcp__two__t1', 'mcp__two__t2']);
  const statuses = await service.statuses();
  assert.deepEqual(statuses.map(status => [status.name, status.connected, status.toolCount]), [
    ['one', true, 2],
    ['two', true, 2]
  ]);
  assert.equal(statuses[0].serverName, 'fake-server');
  await service.dispose();
});

test('disabled servers are skipped and duplicate names cannot collide', async () => {
  const { service } = serverService([
    { name: 'skip-me', command: 'node', enabled: false },
    { name: 'dupe', command: 'node' },
    { name: 'DUPE', command: 'node' }
  ]);
  const statuses = await service.statuses();
  assert.deepEqual(statuses.map(status => status.name), ['dupe'], 'duplicates would collide in the tool registry');
  await service.dispose();
});

test('a server that fails to connect degrades to a status, not an exception', async () => {
  const service = new McpServerService(
    [{ name: 'broken', command: 'definitely-not-a-real-binary' }],
    () => ({
      async start() {
        throw new Error('spawn ENOENT');
      },
      async send() {
        return undefined;
      },
      async close() {
        return undefined;
      }
    }),
    { connectTimeoutMs: 200 }
  );
  const tools = await service.tools();
  assert.deepEqual(tools, [], 'the agent still works without the server');
  const statuses = await service.statuses();
  assert.equal(statuses[0].connected, false);
  assert.match(statuses[0].error, /ENOENT/);
  await service.dispose();
});

test('a server that never answers is bounded by the connect timeout', async () => {
  const silent = memoryTransport(async () => undefined);
  const service = new McpServerService([{ name: 'silent', command: 'node' }], () => silent.transport, {
    connectTimeoutMs: 30
  });
  const statuses = await service.statuses();
  assert.equal(statuses[0].connected, false);
  assert.match(statuses[0].error, /did not finish connecting/);
  await service.dispose();
});

test('refresh reconnects and dispose closes the server processes', async () => {
  const { service, transports } = serverService([{ name: 'one', command: 'node' }]);
  await service.tools();
  await service.refresh();
  await service.tools();
  assert.equal(transports.length, 2, 'refresh has to build a new connection');
  await service.dispose();
});
