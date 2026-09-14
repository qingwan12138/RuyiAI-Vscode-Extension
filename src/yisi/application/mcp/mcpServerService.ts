import { McpDeclaredRisk, McpServerConfiguration, McpToolDefinition, McpTransport } from '../../domain/mcpPort';
import { YisiTool } from '../../domain/tool';
import { McpClient } from './mcpClient';
import { createMcpTools, isMcpToolId } from './mcpToolBridge';

/**
 * Owns the configured MCP servers: connects them once, turns their tools into
 * Yisi tools, and shuts the processes down when the extension deactivates.
 *
 * Failure is contained by design. An MCP server is optional infrastructure the
 * user installed; if it is missing, hangs, or speaks a broken protocol, the agent
 * must still work — so every failure becomes a recorded status and zero tools,
 * never an exception that would take the runner down with it.
 *
 * Tools are collected once and memoised: the agent's tool list is part of the
 * request prefix, so it must not change shape mid-session. `refresh()` is the
 * explicit way to pick up a changed server.
 */

export interface McpServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  serverName?: string;
  serverVersion?: string;
  error?: string;
}

export interface McpServerServiceOptions {
  /** Bound on the handshake + tool listing for one server. */
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  clientVersion?: string;
}

interface McpConnection {
  configuration: McpServerConfiguration;
  client?: McpClient;
  tools: YisiTool[];
  status: McpServerStatus;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export class McpServerService {
  private connections?: Promise<McpConnection[]>;

  constructor(
    private readonly configurations: readonly McpServerConfiguration[],
    private readonly createTransport: (configuration: McpServerConfiguration) => McpTransport,
    private readonly options: McpServerServiceOptions = {}
  ) {}

  /** Every bridged tool from every enabled server that connected. */
  async tools(): Promise<YisiTool[]> {
    const connections = await this.connectAll();
    return connections.flatMap(connection => connection.tools);
  }

  async statuses(): Promise<McpServerStatus[]> {
    const connections = await this.connectAll();
    return connections.map(connection => connection.status);
  }

  /** Drops the memoised connections and reconnects on the next call. */
  async refresh(): Promise<void> {
    const previous = this.connections;
    this.connections = undefined;
    if (previous) await closeAll(await previous);
  }

  async dispose(): Promise<void> {
    const previous = this.connections;
    this.connections = undefined;
    if (previous) await closeAll(await previous);
  }

  private connectAll(): Promise<McpConnection[]> {
    this.connections ??= Promise.all(this.enabledConfigurations().map(configuration => this.connectOne(configuration)));
    return this.connections;
  }

  /**
   * Duplicate names are dropped rather than merged: the name is what namespaces
   * the tools, so two servers sharing one would produce colliding tool ids and
   * the runner refuses to build at all.
   */
  private enabledConfigurations(): McpServerConfiguration[] {
    const seen = new Set<string>();
    const enabled: McpServerConfiguration[] = [];
    for (const configuration of this.configurations) {
      if (configuration?.enabled === false) continue;
      const name = String(configuration?.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      enabled.push({ ...configuration, name });
    }
    return enabled;
  }

  private async connectOne(configuration: McpServerConfiguration): Promise<McpConnection> {
    const controller = new AbortController();
    const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    const client = new McpClient(this.createTransport(configuration), {
      ...(this.options.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.options.requestTimeoutMs } : {}),
      ...(this.options.clientVersion !== undefined ? { clientVersion: this.options.clientVersion } : {})
    });
    try {
      const identity = await client.connect(controller.signal);
      const definitions = await client.listTools(controller.signal);
      const tools = createMcpTools({
        serverName: configuration.name,
        definitions,
        client,
        ...(configuration.toolRisks ? { toolRisks: configuration.toolRisks } : {})
      });
      return {
        configuration,
        client,
        tools,
        status: {
          name: configuration.name,
          connected: true,
          toolCount: tools.length,
          ...(identity.name ? { serverName: identity.name } : {}),
          ...(identity.version ? { serverVersion: identity.version } : {})
        }
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      return {
        configuration,
        tools: [],
        status: {
          name: configuration.name,
          connected: false,
          toolCount: 0,
          error: describeFailure(error, timeoutMs)
        }
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function describeFailure(error: unknown, timeoutMs: number): string {
  if (isAbortError(error)) {
    return `The MCP server did not finish connecting within ${timeoutMs}ms.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 600) || 'The MCP server could not be connected.';
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function closeAll(connections: readonly McpConnection[]): Promise<void> {
  await Promise.all(
    connections.map(connection => connection.client?.close().catch(() => undefined) ?? Promise.resolve())
  );
}

export { isMcpToolId };
export type { McpDeclaredRisk, McpToolDefinition };
