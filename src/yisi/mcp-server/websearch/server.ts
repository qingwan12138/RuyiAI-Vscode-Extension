import { SearchBackend, WebTool, WebToolContext, createSearxngBackend, createWebTools } from './webTools';
// The backend address has exactly one definition, shared with the setup command that
// tells the user what to paste. Two copies of a default is how documentation and
// behaviour drift apart.
import { DEFAULT_SEARXNG_URL, WEB_SEARCH_BACKEND_ENV } from '../../application/mcp/webSearchSetup';
import {
  DEFAULT_NATIVE_SEARCH_MODEL,
  DEFAULT_SEARCH_BASE_URL,
  createNativeSearchBackend
} from './nativeSearchBackend';

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

export type SearchBackendKind = 'searxng' | 'native' | 'none';

export interface SearchBackendChoice {
  backend?: SearchBackend;
  kind: SearchBackendKind;
  /** A short, non-secret explanation for the log and for the user. Empty when obvious. */
  note: string;
}

/**
 * Chooses the search backend from the environment, in one place so the precedence is
 * reviewable rather than scattered through `main`.
 *
 * Precedence is "explicit beats implicit":
 *   1. `YISI_SEARCH_BACKEND` — a deliberate choice, including `none` to switch search off.
 *   2. `YISI_SEARXNG_URL` — the user went to the trouble of naming a SearXNG instance.
 *   3. a model key (`YISI_SEARCH_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY`) —
 *      zero setup: the key that already exists enables native server-side search.
 *
 * Backends live in the environment because an `yisiAI.mcpServers` entry cannot carry an
 * `env` map (deliberately: that is where tokens would end up in `settings.json`).
 */
export function resolveSearchBackend(
  env: Record<string, string | undefined>
): SearchBackendChoice {
  const explicit = env.YISI_SEARCH_BACKEND?.trim().toLowerCase();
  const searxngUrl = env[WEB_SEARCH_BACKEND_ENV]?.trim();
  const apiKey = env.YISI_SEARCH_API_KEY?.trim()
    || env.DEEPSEEK_API_KEY?.trim()
    || env.ANTHROPIC_API_KEY?.trim();
  const baseUrl = env.YISI_SEARCH_BASE_URL?.trim() || DEFAULT_SEARCH_BASE_URL;
  const model = env.YISI_SEARCH_MODEL?.trim() || DEFAULT_NATIVE_SEARCH_MODEL;

  if (explicit === 'none') {
    return { kind: 'none', note: 'Search is disabled by YISI_SEARCH_BACKEND=none; web_fetch still works.' };
  }
  if (explicit === 'searxng') {
    return searxngUrl
      ? { backend: createSearxngBackend(searxngUrl), kind: 'searxng', note: `Searching through SearXNG at ${searxngUrl}.` }
      : { kind: 'none', note: 'YISI_SEARCH_BACKEND=searxng needs YISI_SEARXNG_URL, which is not set.' };
  }
  if (explicit === 'native') {
    return apiKey
      ? nativeChoice(baseUrl, apiKey, model)
      : { kind: 'none', note: 'YISI_SEARCH_BACKEND=native needs an API key (YISI_SEARCH_API_KEY, DEEPSEEK_API_KEY or ANTHROPIC_API_KEY).' };
  }
  if (explicit && explicit !== 'auto') {
    return { kind: 'none', note: `Unknown YISI_SEARCH_BACKEND "${explicit}"; use auto, searxng, native or none.` };
  }

  if (searxngUrl) {
    return { backend: createSearxngBackend(searxngUrl), kind: 'searxng', note: `Searching through SearXNG at ${searxngUrl}.` };
  }
  if (apiKey) return nativeChoice(baseUrl, apiKey, model);
  return {
    kind: 'none',
    note: 'No search backend is configured. Set YISI_SEARXNG_URL to a SearXNG instance, or provide a model key '
      + '(DEEPSEEK_API_KEY) to use the provider\'s own server-side search. web_fetch works without either.'
  };
}

function nativeChoice(baseUrl: string, apiKey: string, model: string): SearchBackendChoice {
  return {
    backend: createNativeSearchBackend({ baseUrl, apiKey, model }),
    kind: 'native',
    // Deliberately reports the endpoint and model but never the key.
    note: `Search uses server-side web search at ${baseUrl} (model ${model}); each search costs one model turn.`
  };
}

/** The stdio wrapper: one JSON object per line in, one out. */
export async function main(): Promise<void> {
  const choice = resolveSearchBackend(process.env);
  const server = createWebSearchServer(choice.backend ? { search: choice.backend } : {});
  if (choice.note) process.stderr.write(`[yisi-websearch] ${choice.note}\n`);

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
