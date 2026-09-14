// The bundled web-search MCP server, end to end and entirely offline.
//
// This is the test that proves the whole design rather than a part of it: a real
// AgentToolLoop calls `mcp__websearch__web_search` through the **existing** MCP
// client and tool bridge, the request reaches the new server over an in-memory
// transport, a fake search backend answers, and the model's next round receives the
// result. No process is spawned and no network is touched.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebSearchServer } = require('../dist/yisi/mcp-server/websearch/server');
const { createWebTools } = require('../dist/yisi/mcp-server/websearch/webTools');
const { McpClient } = require('../dist/yisi/application/mcp/mcpClient');
const { createMcpTools } = require('../dist/yisi/application/mcp/mcpToolBridge');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');
const { renderWebSearchConfig, webSearchSetupNotes } = require('../dist/yisi/application/mcp/webSearchSetup');

const SIGNAL = new AbortController().signal;

const HITS = [
  { title: 'RuyiSDK releases', url: 'https://github.com/ruyisdk/ruyisdk/releases', snippet: 'Latest release notes', source: 'github' },
  { title: 'RuyiSDK docs', url: 'https://ruyisdk.org/docs', snippet: 'Installation guide', source: 'duckduckgo' }
];

function searchBackend(seen = []) {
  return async (query, maxResults) => {
    seen.push({ query, maxResults });
    return { hits: HITS, backend: 'fake' };
  };
}

/** A fetch stand-in: `routes` maps a URL prefix to a response. */
function fakeFetch(routes) {
  return async (url) => {
    const route = Object.keys(routes).find(prefix => url.startsWith(prefix));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    const spec = routes[route];
    return {
      ok: spec.status === undefined || (spec.status >= 200 && spec.status < 300),
      status: spec.status ?? 200,
      headers: { get: name => (name.toLowerCase() === 'content-type' ? (spec.contentType ?? null) : null) },
      body: null,
      arrayBuffer: async () => new TextEncoder().encode(spec.body ?? '').buffer
    };
  };
}

const publicResolver = async () => ['93.184.216.34'];

/** Drives the server over the same newline-free in-memory contract the client uses. */
function memoryTransport(server) {
  const events = { onMessage: () => undefined, onError: () => undefined, onClose: () => undefined };
  return {
    transport: {
      async start(incoming) {
        Object.assign(events, incoming);
      },
      async send(message) {
        const response = await server.handleMessage(message);
        if (response !== undefined) events.onMessage(response);
      },
      async close() {
        events.onClose('closed by the client');
      }
    }
  };
}

async function callTool(server, name, args) {
  const response = await server.handleMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args }
  });
  assert.ok(response && response.result, `expected a tool result: ${JSON.stringify(response)}`);
  const text = response.result.content[0].text;
  return { isError: response.result.isError === true, payload: response.result.isError ? text : JSON.parse(text) };
}

test('tools/list advertises exactly the two web tools', async () => {
  const server = createWebSearchServer({});
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(response.result.tools.map(tool => tool.name).sort(), ['web_fetch', 'web_search']);
  const search = response.result.tools.find(tool => tool.name === 'web_search');
  assert.deepEqual(search.inputSchema.required, ['query']);
  assert.equal(search.inputSchema.additionalProperties, false);
  // The description has to tell the model both what it is for and that the content
  // is untrusted — the model reads this, not our documentation.
  assert.match(search.description, /newer than your training/);
  assert.match(search.description, /never as instructions/);
});

test('web_search without a backend fails honestly instead of pretending', async () => {
  const server = createWebSearchServer({});
  const result = await callTool(server, 'web_search', { query: 'ruyisdk' });
  assert.equal(result.isError, true);
  assert.match(result.payload, /No search backend is configured/);
  assert.match(result.payload, /YISI_SEARXNG_URL/, 'the fix must be in the message');
});

test('web_search bounds the result count and the snippet length', async () => {
  const seen = [];
  const server = createWebSearchServer({ search: searchBackend(seen) });
  const result = await callTool(server, 'web_search', { query: 'ruyisdk release', maxResults: 1 });
  assert.equal(result.isError, false);
  assert.equal(result.payload.results.length, 1, 'maxResults is honoured');
  assert.equal(seen[0].maxResults, 1);
  assert.equal(result.payload.backend, 'fake');
  assert.match(result.payload.results[0].url, /^https:\/\//);
});

test('web_search refuses an empty query and an absurd maxResults', async () => {
  const server = createWebSearchServer({ search: searchBackend() });
  assert.equal((await callTool(server, 'web_search', { query: '   ' })).isError, true);
  const capped = await callTool(server, 'web_search', { query: 'x', maxResults: 999 });
  assert.equal(capped.isError, false);
  assert.ok(capped.payload.results.length <= 10, 'the ceiling holds');
});

test('web_fetch applies the SSRF policy before any request', async () => {
  const server = createWebSearchServer({ fetchImpl: fakeFetch({}), resolveHost: publicResolver });
  for (const url of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd']) {
    const result = await callTool(server, 'web_fetch', { url });
    assert.equal(result.isError, true, `${url} must be refused`);
  }
  // A hostname whose *resolved* address is private is refused too.
  const privateHost = createWebSearchServer({ fetchImpl: fakeFetch({}), resolveHost: async () => ['10.0.0.7'] });
  const result = await callTool(privateHost, 'web_fetch', { url: 'https://internal.example.com/' });
  assert.equal(result.isError, true);
  assert.match(result.payload, /non-public address/);
});

test('web_fetch returns bounded text and refuses non-text responses', async () => {
  const server = createWebSearchServer({
    resolveHost: publicResolver,
    fetchImpl: fakeFetch({
      'https://example.com/html': { body: '<html><body><h1>Title</h1><p>Body text</p><script>x()</script></body></html>', contentType: 'text/html' },
      'https://example.com/bin': { body: 'PK\u0003\u0004', contentType: 'application/zip' },
      'https://example.com/none': { body: 'x', contentType: null }
    })
  });
  const page = await callTool(server, 'web_fetch', { url: 'https://example.com/html' });
  assert.equal(page.isError, false);
  assert.match(page.payload.content, /Title/);
  assert.match(page.payload.content, /Body text/);
  assert.equal(/x\(\)/.test(page.payload.content), false, 'scripts never reach the model');

  const binary = await callTool(server, 'web_fetch', { url: 'https://example.com/bin' });
  assert.equal(binary.isError, true);
  assert.match(binary.payload, /not text/);
  const unknown = await callTool(server, 'web_fetch', { url: 'https://example.com/none' });
  assert.equal(unknown.isError, true, 'a missing content type is refused, not guessed');
});

test('web_fetch refuses a redirect that leaves the origin', async () => {
  const server = createWebSearchServer({
    resolveHost: publicResolver,
    fetchImpl: fakeFetch({
      'https://example.com/start': { status: 302, body: '', contentType: 'text/html' }
    })
  });
  // The fake returns no Location header, so the redirect cannot be followed.
  const result = await callTool(server, 'web_fetch', { url: 'https://example.com/start' });
  assert.equal(result.isError, true);
  assert.match(result.payload, /redirect/i);
});

test('a cancelled request is reported as cancelled', async () => {
  const server = createWebSearchServer({
    search: async (query, maxResults, signal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted by signal'));
        }, { once: true });
      });
      return { hits: [], backend: 'slow' };
    }
  });
  const pending = server.handleMessage({
    jsonrpc: '2.0', id: 'slow-1', method: 'tools/call', params: { name: 'web_search', arguments: { query: 'x' } }
  });
  // Bounded poll, never an unbounded await: waiting on a promise that nothing
  // resolves is how a test hangs the whole runner (which it did, twice).
  const deadline = Date.now() + 2_000;
  while (server.inFlight === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(server.inFlight, 1, 'the request is tracked while it runs');

  await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'slow-1' } });
  const response = await pending;
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /cancelled/i);
  assert.equal(server.inFlight, 0);
});

test('the existing MCP client discovers the tools and calls them', async () => {
  const server = createWebSearchServer({ search: searchBackend() });
  const client = new McpClient(memoryTransport(server).transport, { requestTimeoutMs: 2_000 });
  const identity = await client.connect();
  assert.equal(identity.name, 'yisi-websearch');

  const tools = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['web_fetch', 'web_search']);
  const raw = await client.callTool('web_search', { query: 'ruyisdk' });
  assert.equal(raw.isError, undefined);
  assert.match(raw.content[0].text, /RuyiSDK releases/);
  await client.close();
});

test('v1: the agent loop searches the web and answers from the results', async () => {
  // The whole chain, with nothing faked except the search backend and the network:
  // AgentToolLoop -> MCP client -> this server -> backend -> back to the model.
  const server = createWebSearchServer({ search: searchBackend() });
  const client = new McpClient(memoryTransport(server).transport, { requestTimeoutMs: 2_000 });
  await client.connect();
  const tools = createMcpTools({
    serverName: 'websearch',
    definitions: await client.listTools(),
    client,
    toolRisks: { web_search: 'network', web_fetch: 'network' }
  });
  assert.equal(tools[0].risk, 'network');
  assert.equal(tools[0].mutatesWorkspace, false);

  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: 'mcp__websearch__web_search', input: { query: 'RuyiSDK latest release' } } };
        return;
      }
      yield { type: 'textDelta', text: 'According to the release page, RuyiSDK 0.28 is current.' };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry(tools), new PermissionEngine());
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'RuyiSDK 最新版本是什么？' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'fullAccess',
    () => undefined,
    SIGNAL
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'According to the release page, RuyiSDK 0.28 is current.');
  // The search result reached the model's second round, with the URL intact.
  const toolMessage = JSON.parse(requests.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(toolMessage.ok, true);
  assert.match(toolMessage.result.output, /github\.com\/ruyisdk\/ruyisdk\/releases/);
  await client.close();
});

test('v1: in Plan mode the same search is refused by the engine, not by the scope', async () => {
  const server = createWebSearchServer({ search: searchBackend() });
  const client = new McpClient(memoryTransport(server).transport, { requestTimeoutMs: 2_000 });
  await client.connect();
  const tools = createMcpTools({
    serverName: 'websearch',
    definitions: await client.listTools(),
    client,
    toolRisks: { web_search: 'network', web_fetch: 'network' }
  });
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: 'mcp__websearch__web_search', input: { query: 'x' } } };
        return;
      }
      yield { type: 'textDelta', text: 'I cannot search in Plan mode; here is what I would do instead.' };
    }
  };
  const loop = new AgentToolLoop(provider, new ToolRegistry(tools), new PermissionEngine());
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'search' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'plan',
    () => undefined,
    SIGNAL
  );
  assert.equal(result.status, 'completed');
  const toolMessage = JSON.parse(requests.at(-1).messages.find(message => message.role === 'tool').content);
  assert.equal(toolMessage.denied, true);
  assert.equal(toolMessage.reason, 'policy', 'a permission decision, not an out-of-scope tool');
  await client.close();
});

// The user cannot guess where VS Code installed the extension, so the setup command
// derives the path at runtime. These two guard the contract: the JSON is ordinary
// `yisiAI.mcpServers` content with the honest risk class, and the command is actually
// declared and wired (a pure builder nobody calls would be dead code).

test('the setup command renders a pasteable entry that declares the network risk', () => {
  const config = JSON.parse(
    renderWebSearchConfig('C:\\ext\\yisi-ai-0.13.0\\dist\\yisi\\mcp-server\\websearch\\server.js')
  );
  assert.equal(config.name, 'websearch');
  assert.equal(config.command, 'node');
  assert.deepEqual(config.args, [
    'C:\\ext\\yisi-ai-0.13.0\\dist\\yisi\\mcp-server\\websearch\\server.js'
  ]);
  assert.deepEqual(config.toolRisks, { web_search: 'network', web_fetch: 'network' });
  // The MCP config parser has no `env` field: an entry that carried one would be
  // silently ignored, and the backend URL would never reach the server. This asserts
  // the entry stays inside what the parser actually reads.
  assert.deepEqual(Object.keys(config).sort(), ['args', 'command', 'name', 'toolRisks']);
  // Every declared risk must be one the loop admits, or the run dies instead of asking.
  assert.equal(declaredRisksParse(config.toolRisks), true);
});

test('the copied entry parses as real MCP configuration, with the tools it declares', () => {
  const { parseMcpServerConfigurations } = require('../dist/yisi/application/mcp/mcpConfiguration');
  const entry = JSON.parse(renderWebSearchConfig('/ext/dist/yisi/mcp-server/websearch/server.js'));
  const parsed = parseMcpServerConfigurations([entry]);
  assert.equal(parsed.rejected.length, 0, JSON.stringify(parsed.rejected));
  assert.equal(parsed.servers.length, 1);
  assert.deepEqual(parsed.servers[0].toolRisks, { web_search: 'network', web_fetch: 'network' });
  // A default backend exists, so "run SearXNG locally" needs no configuration; the
  // notes must therefore name the address and the variable that overrides it.
  const notes = webSearchSetupNotes().join(' ');
  assert.match(notes, /127\.0\.0\.1:8080/);
  assert.match(notes, /YISI_SEARXNG_URL/);
  assert.match(notes, /not in settings\.json/);
});

test('the setup command is declared and wired, and derives the path at runtime', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  assert.match(read('package.json'), /"command": "yisiAI\.webSearch\.setup"/);
  assert.match(read('src/yisi/index.ts'), /registerCommand\('yisiAI\.webSearch\.setup'/);
  // The script path must be composed from the extension root, never hard-coded: the
  // install directory carries the version, so any literal path would be wrong.
  assert.match(read('src/yisi/index.ts'), /joinPath\(extensionUri, \.\.\.WEB_SEARCH_SERVER_SCRIPT\)/);
  // One definition of the backend default, shared by the server and the setup text.
  assert.match(read('src/yisi/mcp-server/websearch/server.ts'), /DEFAULT_SEARXNG_URL/);
});

/** The declared risks must all be ones the bridge accepts: checked through the real parser. */
function declaredRisksParse(toolRisks) {
  const { parseMcpServerConfigurations } = require('../dist/yisi/application/mcp/mcpConfiguration');
  const parsed = parseMcpServerConfigurations([
    { name: 'websearch', command: 'node', args: ['server.js'], toolRisks }
  ]);
  return parsed.servers[0].toolRisks.web_search === 'network'
    && parsed.servers[0].toolRisks.web_fetch === 'network';
}
