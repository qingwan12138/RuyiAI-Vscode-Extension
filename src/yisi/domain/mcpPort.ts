import { ToolRisk } from './tool';

/**
 * MCP (Model Context Protocol) port shapes.
 *
 * Clean-room note: this describes the **public protocol** — JSON-RPC 2.0 framing
 * plus the `initialize` / `tools/list` / `tools/call` methods — and Yisi's own
 * carrying types. No reference client implementation, prompt text or asset was
 * copied (docs/04). Only the behaviour is implemented, from the published spec.
 *
 * The transport is an interface so the protocol layer (application/mcp) can be
 * tested without spawning anything; the process-backed implementation lives in
 * infrastructure/mcp/stdioMcpTransport.ts.
 */

/**
 * The risk classes the agent loop's bounded scope admits for a bridged MCP tool.
 * `destructive` and `credentialSensitive` are deliberately absent: the loop
 * refuses those outright, so declaring one would only produce "outside the
 * bounded Agent tool scope" failures instead of a permission decision.
 *
 * `network` **is** declarable: a search or fetch tool should say what it does, so
 * the engine can deny it in Plan mode and the approval card can name it, rather
 * than having to be mislabelled `readOnly` (which would let network egress pass
 * silently in every mode). See docs/decisions/ADR-0005.
 */
export type McpDeclaredRisk = Extract<
  ToolRisk,
  'readOnly' | 'workspaceWrite' | 'processExec' | 'environmentChange' | 'network'
>;

export interface McpServerConfiguration {
  /** Stable name used for tool namespacing and the UI. */
  name: string;
  /** Executable, spawned with `shell: false`; never a shell command line. */
  command: string;
  args?: readonly string[];
  enabled?: boolean;
  /**
   * Narrow the risk of individual tools. Anything not listed keeps the
   * conservative default, because an MCP server's effects cannot be inspected
   * from the outside.
   */
  toolRisks?: Readonly<Record<string, McpDeclaredRisk>>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the tool arguments, as the server declared it. */
  inputSchema?: Readonly<Record<string, unknown>>;
}

export interface McpContentPart {
  type: string;
  text?: string;
  mimeType?: string;
  data?: string;
}

export interface McpCallResult {
  content?: readonly McpContentPart[];
  isError?: boolean;
}

export interface McpServerIdentity {
  name?: string;
  version?: string;
  protocolVersion?: string;
}

export interface McpTransportEvents {
  onMessage(message: unknown): void;
  onError(error: Error): void;
  onClose(reason: string): void;
}

export interface McpTransport {
  /** Starts the connection and begins delivering events. */
  start(events: McpTransportEvents): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}
