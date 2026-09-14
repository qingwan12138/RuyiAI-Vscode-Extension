import { McpCallResult, McpServerIdentity, McpToolDefinition, McpTransport } from '../../domain/mcpPort';

/**
 * A minimal MCP client: JSON-RPC 2.0 correlation over an injected transport, the
 * initialize handshake, and the three methods Yisi actually uses (tools/list,
 * tools/call, plus the shutdown notification).
 *
 * Bounded by construction:
 *  - every request has a timeout, so a wedged server cannot hang a run forever;
 *  - a caller's AbortSignal cancels the request (and the loop's Stop works);
 *  - server-initiated requests (sampling, roots) are answered with JSON-RPC
 *    "method not found" rather than silently ignored, because a server waiting
 *    for an answer that never comes looks like a hang.
 *
 * Clean-room: implements the published protocol only; no reference client code
 * was read or copied (docs/04).
 */

export class McpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpProtocolError';
  }
}

export class McpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTimeoutError';
  }
}

export interface McpClientOptions {
  requestTimeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
  /** Bound on tools/list pagination, so a server cannot loop the client forever. */
  maxToolPages?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  settle: () => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOOL_PAGES = 10;
/**
 * A recent, widely implemented revision. The server answers with the revision it
 * supports and that answer is accepted as-is: refusing a server over a version
 * string would break working setups for no safety gain.
 */
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const METHOD_NOT_FOUND = -32601;

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;
  private closeReason = 'The MCP connection was closed.';
  private started = false;

  constructor(
    private readonly transport: McpTransport,
    private readonly options: McpClientOptions = {}
  ) {}

  async connect(signal?: AbortSignal): Promise<McpServerIdentity> {
    if (!this.started) {
      await this.transport.start({
        onMessage: message => this.handleMessage(message),
        onError: error => this.failAll(error instanceof Error ? error : new Error(String(error))),
        onClose: reason => {
          if (reason) this.closeReason = reason;
          this.failAll(new McpProtocolError(this.closeReason));
        }
      });
      this.started = true;
    }
    const result = await this.request(
      'initialize',
      {
        protocolVersion: this.options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: this.options.clientName ?? 'yisi-ai',
          version: this.options.clientVersion ?? '0.1.7'
        }
      },
      signal
    );
    // The spec requires this notification before any other request.
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const record = asRecord(result);
    const serverInfo = asRecord(record.serverInfo);
    return {
      ...(typeof serverInfo.name === 'string' ? { name: serverInfo.name } : {}),
      ...(typeof serverInfo.version === 'string' ? { version: serverInfo.version } : {}),
      ...(typeof record.protocolVersion === 'string' ? { protocolVersion: record.protocolVersion } : {})
    };
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDefinition[]> {
    const tools: McpToolDefinition[] = [];
    const maxPages = this.options.maxToolPages ?? DEFAULT_MAX_TOOL_PAGES;
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, signal);
      const record = asRecord(result);
      if (!Array.isArray(record.tools)) throw new McpProtocolError('tools/list did not return a tools array.');
      for (const entry of record.tools) {
        const tool = parseMcpToolDefinition(entry);
        if (tool) tools.push(tool);
      }
      const next = record.nextCursor;
      if (typeof next !== 'string' || !next) return tools;
      cursor = next;
    }
    return tools;
  }

  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: { signal?: AbortSignal } = {}
  ): Promise<McpCallResult> {
    const result = await this.request('tools/call', { name, arguments: args }, options.signal);
    const record = asRecord(result);
    return {
      ...(Array.isArray(record.content) ? { content: record.content.map(parseContentPart) } : {}),
      ...(record.isError === true ? { isError: true } : {})
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll(new McpProtocolError(this.closeReason));
    await this.transport.close();
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new McpProtocolError(this.closeReason));
    if (signal?.aborted) return Promise.reject(abortError());
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.settle(id);
              reject(new McpTimeoutError(`MCP request "${method}" timed out after ${timeoutMs}ms.`));
            }, timeoutMs)
          : undefined;
      const onAbort = signal
        ? () => {
            this.settle(id);
            reject(abortError());
          }
        : undefined;
      const settle = (): void => {
        if (timer) clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      this.pending.set(id, { resolve, reject, settle });
      if (signal && onAbort) signal.addEventListener('abort', onAbort, { once: true });
      this.transport.send({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
        this.settle(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Removes a pending request and runs its cleanup exactly once. */
  private settle(id: number): PendingRequest | undefined {
    const pending = this.pending.get(id);
    pending?.settle();
    return pending;
  }

  private handleMessage(message: unknown): void {
    const record = asRecord(message);
    const hasId = typeof record.id === 'number';
    if (hasId && ('result' in record || 'error' in record)) {
      const pending = this.settle(record.id as number);
      if (!pending) return; // Late answer to a timed-out or cancelled request.
      if ('error' in record) {
        const error = asRecord(record.error);
        const detail = typeof error.message === 'string' ? error.message : 'unknown error';
        const code = typeof error.code === 'number' ? ` (code ${error.code})` : '';
        pending.reject(new McpProtocolError(`MCP server error: ${detail}${code}`));
        return;
      }
      pending.resolve(record.result);
      return;
    }
    if (hasId && typeof record.method === 'string') {
      // A server-initiated request we do not implement. Answering is required:
      // an unanswered request looks like a hang to the server.
      void this.transport
        .send({
          jsonrpc: '2.0',
          id: record.id,
          error: { code: METHOD_NOT_FOUND, message: `Unsupported client method: ${record.method}` }
        })
        .catch(() => undefined);
      return;
    }
    // Notifications (logging, progress, list-changed) carry no response and are
    // not needed to serve a tool call, so they are deliberately ignored.
  }

  private failAll(error: Error): void {
    for (const [id, pending] of [...this.pending]) {
      this.settle(id);
      pending.reject(error);
    }
  }
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function parseMcpToolDefinition(value: unknown): McpToolDefinition | undefined {
  const record = asRecord(value);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return undefined;
  const description = typeof record.description === 'string' ? record.description : undefined;
  const inputSchema = isRecord(record.inputSchema) ? record.inputSchema : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    ...(inputSchema ? { inputSchema } : {})
  };
}

function parseContentPart(value: unknown): { type: string; text?: string; mimeType?: string; data?: string } {
  const record = asRecord(value);
  const part: { type: string; text?: string; mimeType?: string; data?: string } = {
    type: typeof record.type === 'string' ? record.type : 'unknown'
  };
  if (typeof record.text === 'string') part.text = record.text;
  if (typeof record.mimeType === 'string') part.mimeType = record.mimeType;
  if (typeof record.data === 'string') part.data = record.data;
  return part;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
