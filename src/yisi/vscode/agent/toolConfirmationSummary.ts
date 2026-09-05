import { ToolConfirmationRequest } from '../../application/agent/readOnlyAgentLoop';

export interface ToolConfirmationSummary {
  message: string;
  detail: string;
}

/**
 * Builds the approval dialog copy for ANY permission-gated tool. The pretty
 * formats below cover the common edit/create surface; every other tool that
 * reaches Manual/Auto-mode confirmation (run_command, run_validations, file
 * operations, undo, ...) still gets a real, actionable summary so the user is
 * asked instead of the request being silently declined.
 */
export function summarizeToolConfirmation(request: ToolConfirmationRequest): ToolConfirmationSummary {
  if (request.toolId === 'create_text_file') {
    const { path, content } = request.input;
    if (typeof path === 'string' && typeof content === 'string') {
      return {
        message: `Create the proposed file ${bounded(path, 180)}?`,
        detail: [`Content: ${printable(content)}`, request.reason].join('\n')
      };
    }
  }
  if (request.toolId === 'replace_text') {
    const { path, oldText, newText } = request.input;
    if (typeof path === 'string' && typeof oldText === 'string' && typeof newText === 'string') {
      return {
        message: `Apply the proposed edit to ${bounded(path, 180)}?`,
        detail: [
          `Replace: ${printable(oldText)}`,
          `With: ${printable(newText)}`,
          request.reason
        ].join('\n')
      };
    }
  }
  return genericSummary(request);
}

function genericSummary(request: ToolConfirmationRequest): ToolConfirmationSummary {
  const specific = describeGatedTool(request);
  const detailParts: string[] = [];
  if (specific.head) detailParts.push(specific.head);
  const input = compactJson(request.input);
  if (input) detailParts.push(`Input: ${printable(input)}`);
  detailParts.push(request.reason);
  return { message: specific.message, detail: detailParts.join('\n') };
}

/**
 * Human message for the confirmation dialog of every gated tool that has no
 * bespoke editor above (replace/create). Never returns a non-actionable copy.
 */
function describeGatedTool(request: ToolConfirmationRequest): { message: string; head?: string } {
  const input = request.input as Record<string, unknown>;
  if (request.toolId === 'run_command') {
    const executable = typeof input.executable === 'string' ? input.executable : undefined;
    const args = Array.isArray(input.args)
      ? (input.args as unknown[]).filter((arg): arg is string => typeof arg === 'string')
      : [];
    const head = executable ? ['$', executable, ...args].join(' ') : undefined;
    return { message: 'Run the proposed command?', head };
  }
  if (request.toolId === 'run_validations') {
    return { message: 'Run the proposed project validations?' };
  }
  if (request.toolId === 'rewrite_text_file' && typeof input.path === 'string') {
    return { message: `Replace the whole content of ${bounded(input.path, 180)}?` };
  }
  if (request.toolId === 'delete_file' && typeof input.path === 'string') {
    return { message: `Delete ${bounded(input.path, 180)}?` };
  }
  if (request.toolId === 'create_directory' && typeof input.path === 'string') {
    return { message: `Create directory ${bounded(input.path, 180)}?` };
  }
  if (request.toolId === 'rename_file') {
    if (typeof input.fromPath === 'string' && typeof input.toPath === 'string') {
      return { message: `Move ${bounded(input.fromPath, 140)} to ${bounded(input.toPath, 140)}?` };
    }
    return { message: 'Move the proposed file?' };
  }
  if (request.toolId === 'undo_last_edit') {
    return { message: "Undo the agent's last workspace edit?" };
  }
  return { message: `Approve the proposed ${bounded(request.toolId, 80)} action?` };
}

function printable(value: string): string {
  return bounded(value.replace(/\r/g, '\\r').replace(/\n/g, '\\n'), 400);
}

/** Compact JSON preview of the tool input (never more than ~400 chars). */
function compactJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return json && json !== '{}' ? json : undefined;
  } catch {
    return '[unserializable input]';
  }
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
