import { ToolConfirmationRequest } from '../../application/agent/readOnlyAgentLoop';

export interface ToolConfirmationSummary {
  message: string;
  detail: string;
}

export function summarizeToolConfirmation(request: ToolConfirmationRequest): ToolConfirmationSummary | undefined {
  if (request.toolId !== 'replace_text') return undefined;
  const { path, oldText, newText } = request.input;
  if (typeof path !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') return undefined;
  return {
    message: `Apply the proposed edit to ${bounded(path, 180)}?`,
    detail: [
      `Replace: ${printable(oldText)}`,
      `With: ${printable(newText)}`,
      request.reason
    ].join('\n')
  };
}

function printable(value: string): string {
  return bounded(value.replace(/\r/g, '\\r').replace(/\n/g, '\\n'), 400);
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
