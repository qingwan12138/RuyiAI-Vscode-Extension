import { ConversationItem } from '../../domain/session';
import { YisiTool } from '../../domain/tool';
import { estimateTokens } from '../context/contextUsage';

export interface SessionHistoryReport {
  turnCount: number;
  userTurns: number;
  assistantTurns: number;
  estimatedTokens: number;
  truncated: boolean;
  summary: string;
}

export type HistoryResolver = () => Promise<SessionHistoryReport | null>;

/**
 * History management surface (v0.7): summarize the active session's turn count
 * and estimated token usage so the agent knows how large the context is and
 * can decide to compact/prune before it overflows.
 */
export function summarizeSessionHistory(items: ConversationItem[], maxTurns = 200): SessionHistoryReport {
  const capped = items.slice(-maxTurns);
  let userTurns = 0;
  let assistantTurns = 0;
  let tokens = 0;
  for (const item of capped) {
    if (item.type === 'userMessage') userTurns += 1;
    else if (item.source === 'provider') assistantTurns += 1;
    tokens += estimateTokens(item.text ?? '');
  }
  const turnCount = capped.length;
  return {
    turnCount,
    userTurns,
    assistantTurns,
    estimatedTokens: tokens,
    truncated: items.length > maxTurns,
    summary: `History: ${turnCount} turns (${userTurns} user / ${assistantTurns} assistant), ~${tokens} tokens.${items.length > maxTurns ? ' (older turns omitted)' : ''}`
  };
}

export function createSessionHistoryTool(resolve: HistoryResolver): YisiTool {
  return {
    id: 'session_history',
    description:
      'Report the active session history: turn counts (user/assistant), estimated total tokens, and whether older turns were omitted. Use it to gauge context pressure and decide whether to compact or start a fresh session before continuing a long task.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_input, context) => {
      const report = await resolve().catch(() => null);
      return report ?? {
        turnCount: 0,
        userTurns: 0,
        assistantTurns: 0,
        estimatedTokens: 0,
        truncated: false,
        summary: 'No active session history to report.'
      };
    }
  };
}
