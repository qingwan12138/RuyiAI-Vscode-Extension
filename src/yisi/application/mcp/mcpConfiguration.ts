import { McpDeclaredRisk, McpServerConfiguration } from '../../domain/mcpPort';
import { isMcpDeclaredRisk } from './mcpToolBridge';

/**
 * Parses the `yisiAI.mcpServers` setting into server configurations.
 *
 * The setting is user-authored JSON in VS Code's settings editor, so every field
 * is treated as untrusted input: malformed entries are **rejected with a reason**
 * rather than coerced into something that would spawn an unexpected process. The
 * caller logs the rejections — a silently ignored server would look like a bug.
 *
 * Kept free of `vscode` imports so it can be unit-tested directly; the adapter
 * that reads the setting is a thin call in the composition root.
 */

export interface McpRejectedServer {
  index: number;
  reason: string;
}

export interface McpConfigurationParseResult {
  servers: McpServerConfiguration[];
  rejected: McpRejectedServer[];
}

const MAX_NAME = 64;
const MAX_COMMAND = 1_024;
const MAX_ARGUMENT = 4_096;
const MAX_ARGUMENTS = 64;

export function parseMcpServerConfigurations(value: unknown): McpConfigurationParseResult {
  if (value === undefined || value === null) return { servers: [], rejected: [] };
  if (!Array.isArray(value)) {
    return { servers: [], rejected: [{ index: -1, reason: 'The value must be an array of server objects.' }] };
  }
  const servers: McpServerConfiguration[] = [];
  const rejected: McpRejectedServer[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const parsed = parseOne(entry);
    if ('reason' in parsed) {
      rejected.push({ index, reason: parsed.reason });
      return;
    }
    const key = parsed.name.toLowerCase();
    if (seen.has(key)) {
      // Two servers with the same name would produce colliding tool ids, and the
      // tool registry refuses to build at all rather than guess.
      rejected.push({ index, reason: `Duplicate server name "${parsed.name}".` });
      return;
    }
    seen.add(key);
    servers.push(parsed);
  });
  return { servers, rejected };
}

function parseOne(entry: unknown): McpServerConfiguration | { reason: string } {
  if (!isRecord(entry)) return { reason: 'Each server must be an object.' };
  const rawName = entry.name;
  if (typeof rawName !== 'string' || !rawName.trim()) return { reason: 'A non-empty "name" is required.' };
  const name = rawName.trim();
  if (name.length > MAX_NAME) return { reason: `"name" must be at most ${MAX_NAME} characters.` };

  const rawCommand = entry.command;
  if (typeof rawCommand !== 'string' || !rawCommand.trim()) {
    return { reason: 'A non-empty "command" is required (an executable, not a shell line).' };
  }
  const command = rawCommand.trim();
  if (command.length > MAX_COMMAND || command.includes('\0')) return { reason: '"command" is not usable.' };

  const args = parseArguments(entry.args);
  if ('reason' in args) return args;

  if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
    return { reason: '"enabled" must be true or false.' };
  }

  const toolRisks = parseToolRisks(entry.toolRisks);
  if ('reason' in toolRisks) return toolRisks;

  return {
    name,
    command,
    ...(args.value.length ? { args: args.value } : {}),
    ...(entry.enabled === false ? { enabled: false } : {}),
    ...(Object.keys(toolRisks.value).length ? { toolRisks: toolRisks.value } : {})
  };
}

function parseArguments(value: unknown): { value: string[] } | { reason: string } {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { reason: '"args" must be an array of strings.' };
  if (value.length > MAX_ARGUMENTS) return { reason: `"args" must have at most ${MAX_ARGUMENTS} entries.` };
  const args: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { reason: '"args" must contain only strings.' };
    if (item.length > MAX_ARGUMENT || item.includes('\0')) return { reason: 'An "args" entry is not usable.' };
    args.push(item);
  }
  return { value: args };
}

function parseToolRisks(value: unknown): { value: Record<string, McpDeclaredRisk> } | { reason: string } {
  if (value === undefined) return { value: {} };
  if (!isRecord(value)) return { reason: '"toolRisks" must be an object mapping tool names to risk classes.' };
  const risks: Record<string, McpDeclaredRisk> = {};
  for (const [toolName, risk] of Object.entries(value)) {
    if (!toolName.trim()) return { reason: '"toolRisks" contains an empty tool name.' };
    if (!isMcpDeclaredRisk(risk)) {
      // destructive/credentialSensitive are not declarable: the agent loop refuses
      // them outright, so accepting them here would only produce dead runs.
      return {
        reason: `"toolRisks.${toolName}" must be one of readOnly, workspaceWrite, processExec, environmentChange, network.`
      };
    }
    risks[toolName.trim()] = risk;
  }
  return { value: risks };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
