import { WebTool, WebToolContext, createSearxngBackend, createWebTools } from './webTools';
// The backend address has exactly one definition, shared with the setup command that
// tells the user what to paste. Two copies of a default is how documentation and
// behaviour drift apart.
import { DEFAULT_SEARXNG_URL, WEB_SEARCH_BACKEND_ENV } from '../../application/mcp/webSearchSetup';

/**
 * The bundled web-search MCP server.
 *
 * It speaks the same MCP the extension's client already implements: newline
 * delimited JSON-RPC 2.0 over stdio, with `initialize`, `tools/list` and
 * `tools/call`. Writing it as a separate process rather than inside the extension
 * is the whole point of the design — the agent runtime stays vendor-neutral and the
 * web capability is a plug-in (docs/14: the reference design puts web tools behind
 * a capability seam with swappable providers).
 *
 * `createWebSearchServer` is the protocol layer without any I/O so the tests can
 * drive a complete exchange in-process; `main` is the thin stdio wrapper.
 *
 * Cancellation is honest about its limits: the server *supports* the MCP
 * `notifications/cancelled` notification, but the extension's client does not send
 * it yet (it stops waiting, and the upstream request then dies at its own timeout).
 * Implementing the notification on the server today costs nothing and means Stop
 * becomes truly end-to-end the day the client sends it.
 */

const SERVER_NAME = 'yisi-websearch';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2025-06-18';
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export interface WebSearchServer {
  /** One JSON-RPC message in; one response out, or undefined for a notification. */
  handleMessage(message: unknown): Promise<unknown | undefined>;
  /** Currently running tool calls, for the cancellation test. */
  readonly inFlight: number;
}

export function createWebSearchServer(context: WebToolContext): WebSearchServer {
  const tools = createWebTools(context);
  const running = new Map<string | number, AbortController>();
  return {
    get inFlight() {
      return running.size;
    },
    async handleMessage(message: unknown): Promise<unknown | undefined> {
      if (!isRecord(message)) return errorResponse(undefined, INVALID_PARAMS, 'A JSON-RPC object is required.');
      const { id, method, params } = message;

      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
          }
        };
      }
      if (method === 'notifications/initialized') return undefined;
      if (method === 'notifications/cancelled') {
        const requestId = isRecord(params) ? params.requestId : undefined;
        if (typeof requestId === 'string' || typeof requestId === 'number') running.get(requestId)?.abort();
        return undefined;
      }
      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema
            }))
          }
        };
      }
      if (method === 'tools/call') {
        return callTool(tools, id, params);
      }
      if (id === undefined) return undefined; // an unknown notification is not an error
      return errorResponse(id, METHOD_NOT_FOUND, `Unsupported method: ${String(method)}`);
    }
  };

  async function callTool(
    available: WebTool[],
    id: unknown,
    params: unknown
  ): Promise<unknown | undefined> {
    if (!isRecord(params) || typeof params.name !== 'string') {
      return errorResponse(id, INVALID_PARAMS, 'tools/call requires a tool name.');
    }
    const tool = available.find(candidate => candidate.name === params.name);
    if (!tool) return errorResponse(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
    const rawArgs = isRecord(params.arguments) ? params.arguments : {};
    const key = typeof id === 'string' || typeof id === 'number' ? id : String(id);
    const controller = new AbortController();
    running.set(key, controller);
    try {
      const result = await tool.run(rawArgs, controller.signal);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] }
      };
    } catch (error) {
      // A tool-level failure is a *result* with isError, not a protocol error: the
      // model is supposed to read it and react, exactly as the client's bridge
      // expects (it maps isError onto a failed tool result).
      if (controller.signal.aborted) {
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'The request was cancelled.' }] } };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: message }] } };
    } finally {
      running.delete(key);
    }
  }
}

/** The stdio wrapper: one JSON object per line in, one out. */
export async function main(): Promise<void> {
  // A default, not a placeholder: "run SearXNG locally on its default port" makes the
  // feature work with no configuration. Anything else is an explicit environment
  // variable, because the MCP entry intentionally carries no secret/config map.
  const base = process.env[WEB_SEARCH_BACKEND_ENV]?.trim() || DEFAULT_SEARXNG_URL;
  const server = createWebSearchServer({ search: createSearxngBackend(base) });

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdout.write('');
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          parsed = undefined;
        }
        const response = parsed === undefined
          ? errorResponse(undefined, INVALID_PARAMS, 'The request was not valid JSON.')
          : await server.handleMessage(parsed);
        if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
      }
      index = buffer.indexOf('\n');
    }
  }
}

function errorResponse(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (require.main === module) {
  void main();
}
