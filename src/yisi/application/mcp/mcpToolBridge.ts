import { ToolRisk, YisiTool } from '../../domain/tool';
import { McpCallResult, McpContentPart, McpDeclaredRisk, McpToolDefinition } from '../../domain/mcpPort';
import { McpClient } from './mcpClient';

/**
 * Bridges MCP tools into Yisi's tool contract.
 *
 * Two decisions carry the safety of this bridge:
 *
 * 1. **Namespacing.** Every bridged tool is `mcp__<server>__<tool>`, so an MCP
 *    server can never shadow one of the built-in tools (`run_command`,
 *    `replace_text`, …) — the `mcp__` prefix is reserved and no built-in uses it.
 *
 * 2. **Risk mapping.** An MCP server's effects cannot be inspected from the
 *    outside, so an unclassified tool defaults to `environmentChange`: plan
 *    refuses it, every other mode asks the user, and Full Access allows it. That
 *    is deliberately the same class as `ruyi_manage` — an opaque, locally
 *    configured operation — rather than `readOnly`, which would run silently in
 *    every mode including Plan. A user who has reviewed a server can narrow
 *    individual tools in settings; that declaration is theirs to make.
 *
 * The `(risk, mutatesWorkspace)` pair is normalised here because the agent loop
 * admits exactly four combinations and refuses anything else as "outside the
 * bounded Agent tool scope" — a mismatch would turn a permission decision into a
 * dead run. test/mcp-tool-bridge.test.js couples this table to the real loop.
 */

export const MCP_TOOL_PREFIX = 'mcp__';

/** Unclassified MCP tools ask for approval in every mode but Full Access. */
export const MCP_DEFAULT_RISK: McpDeclaredRisk = 'environmentChange';

export const MCP_RESULT_HEAD_CHARACTERS = 6_000;
export const MCP_RESULT_TAIL_CHARACTERS = 2_000;
const MCP_DESCRIPTION_CHARACTERS = 900;
const SERVER_SEGMENT_CHARACTERS = 32;
const TOOL_SEGMENT_CHARACTERS = 96;

/**
 * The only (risk, mutatesWorkspace) pairs the agent loop admits. Keeping the
 * table here — next to the mapping — is what makes a mismatch a type-level
 * mistake rather than a runtime "outside the bounded scope" failure.
 */
const MUTATES_WORKSPACE: Record<McpDeclaredRisk, boolean> = {
  readOnly: false,
  workspaceWrite: true,
  processExec: true,
  environmentChange: true,
  // A search or fetch sends data out but does not write; the engine still asks
  // about it in every mode except Plan (which refuses) and Full Access.
  network: false
};

export interface McpRiskDeclaration {
  risk: McpDeclaredRisk;
  mutatesWorkspace: boolean;
}

export interface RenderedMcpResult {
  text: string;
  isError: boolean;
  truncated: boolean;
}

/** Resolves the risk class for one MCP tool, normalising its workspace flag. */
export function mcpToolRisk(declared: string | undefined): McpRiskDeclaration {
  const risk = isMcpDeclaredRisk(declared) ? declared : MCP_DEFAULT_RISK;
  return { risk, mutatesWorkspace: MUTATES_WORKSPACE[risk] };
}

export function isMcpDeclaredRisk(value: unknown): value is McpDeclaredRisk {
  return value === 'readOnly'
    || value === 'workspaceWrite'
    || value === 'processExec'
    || value === 'environmentChange'
    || value === 'network';
}

/** `mcp__<server>__<tool>`; segments are sanitised, the tool's real name is not. */
export function mcpToolId(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sanitizeSegment(serverName, SERVER_SEGMENT_CHARACTERS)}__${sanitizeSegment(toolName, TOOL_SEGMENT_CHARACTERS)}`;
}

/** Whether an id belongs to a bridged MCP tool. */
export function isMcpToolId(id: string): boolean {
  return id.startsWith(MCP_TOOL_PREFIX);
}

export interface CreateMcpToolsOptions {
  serverName: string;
  definitions: readonly McpToolDefinition[];
  client: Pick<McpClient, 'callTool'>;
  /** Per-tool risk narrowing, as configured for this server. */
  toolRisks?: Readonly<Record<string, McpDeclaredRisk>>;
}

export function createMcpTools(options: CreateMcpToolsOptions): YisiTool[] {
  const used = new Set<string>();
  const tools: YisiTool[] = [];
  for (const definition of options.definitions) {
    if (!definition || typeof definition.name !== 'string' || !definition.name.trim()) continue;
    const realName = definition.name.trim();
    const id = uniqueId(mcpToolId(options.serverName, realName), used);
    const { risk, mutatesWorkspace } = mcpToolRisk(options.toolRisks?.[realName]);
    tools.push({
      id,
      description: describeTool(options.serverName, realName, definition.description),
      risk,
      mutatesWorkspace,
      supportsCancellation: true,
      inputSchema: normalizeInputSchema(definition.inputSchema),
      execute: async (input, context) => {
        const result = await options.client.callTool(
          realName,
          isRecord(input) ? input : {},
          { signal: context.signal }
        );
        const rendered = renderMcpCallResult(result);
        return {
          ok: !rendered.isError,
          server: options.serverName,
          tool: realName,
          truncated: rendered.truncated,
          output: rendered.text
        };
      }
    });
  }
  return tools;
}

/**
 * Turns an MCP call result into bounded text. Non-text parts are described
 * rather than dropped: silently discarding an image the server sent would leave
 * the model reasoning about a result it never saw.
 */
export function renderMcpCallResult(result: McpCallResult): RenderedMcpResult {
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts: string[] = [];
  const described: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      texts.push(part.text);
    } else {
      described.push(describeContentPart(part));
    }
  }
  const body = [...texts, ...described].join('\n\n').trim();
  const text = body || '(The MCP server returned no content.)';
  const bounded = boundResult(text);
  return { text: bounded.text, isError: result.isError === true, truncated: bounded.truncated };
}

function boundResult(text: string): { text: string; truncated: boolean } {
  const limit = MCP_RESULT_HEAD_CHARACTERS + MCP_RESULT_TAIL_CHARACTERS;
  if (text.length <= limit) return { text, truncated: false };
  // Head *and* tail: MCP servers put summaries first but errors last, and losing
  // either end is worse than losing the middle.
  const head = text.slice(0, MCP_RESULT_HEAD_CHARACTERS);
  const tail = text.slice(-MCP_RESULT_TAIL_CHARACTERS);
  const omitted = text.length - head.length - tail.length;
  return { text: `${head}\n\n[${omitted} characters omitted]\n\n${tail}`, truncated: true };
}

function describeContentPart(part: McpContentPart): string {
  const mime = part.mimeType ? ` ${part.mimeType}` : '';
  const size = typeof part.data === 'string' ? `, ${part.data.length} base64 characters` : '';
  return `[${part.type}${mime}${size} — not shown]`;
}

function describeTool(serverName: string, toolName: string, description: string | undefined): string {
  const summary = (description ?? '').trim();
  const base = summary || `MCP tool "${toolName}" provided by the "${serverName}" server.`;
  const suffix = ` (MCP server: ${serverName})`;
  const room = Math.max(0, MCP_DESCRIPTION_CHARACTERS - suffix.length);
  return `${base.slice(0, room)}${suffix}`;
}

function normalizeInputSchema(schema: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  // The provider wire requires a JSON Schema object; MCP servers may omit it.
  if (!isRecord(schema)) return { type: 'object', properties: {} };
  return schema;
}

function uniqueId(candidate: string, used: Set<string>): string {
  let id = candidate;
  let suffix = 2;
  while (used.has(id)) {
    id = `${candidate}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function sanitizeSegment(value: string, maxLength: number): string {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, maxLength) || 'unnamed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kept for callers that need the declared subset as a ToolRisk value. */
export function asToolRisk(risk: McpDeclaredRisk): ToolRisk {
  return risk;
}
