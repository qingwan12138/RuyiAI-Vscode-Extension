import { PermissionMode } from '../../domain/session';
import { ToolExecutionContext } from '../../domain/tool';
import {
  AgentConversationMessage,
  AgentRequest,
  AgentStreamEvent,
  AgentToolCall,
  RequestSampling
} from '../../llm/types';
import { PermissionEngine } from '../../permissions/permissionEngine';
import { ToolRegistry } from './toolRegistry';

export interface AgentLoopRequest extends RequestSampling {
  model: string;
  messages: AgentConversationMessage[];
}

export interface AgentToolExecutionEvidence {
  callId: string;
  toolId: string;
  outcome: 'succeeded' | 'failed';
  truncated: boolean;
}

export interface AgentLoopResult {
  status: 'completed' | 'blocked';
  finalText: string;
  executions: AgentToolExecutionEvidence[];
  reason?: string;
}

export interface ReadOnlyAgentLoopOptions {
  maxRounds: number;
  maxCallsPerRound: number;
  maxResultCharacters: number;
  maxErrorCharacters: number;
}

interface AgentToolProvider {
  streamAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

export interface ToolConfirmationRequest {
  callId: string;
  toolId: string;
  input: Record<string, unknown>;
  reason: string;
}

export interface ToolConfirmationPort {
  confirm(request: ToolConfirmationRequest, signal: AbortSignal): Promise<boolean>;
}

const DEFAULT_OPTIONS: ReadOnlyAgentLoopOptions = {
  maxRounds: 8,
  maxCallsPerRound: 16,
  maxResultCharacters: 65_536,
  maxErrorCharacters: 240
};

export class AgentToolLoop {
  private readonly options: ReadOnlyAgentLoopOptions;

  constructor(
    private readonly provider: AgentToolProvider,
    private readonly registry: ToolRegistry,
    private readonly permissions: Pick<PermissionEngine, 'evaluate'>,
    options: Partial<ReadOnlyAgentLoopOptions> = {},
    private readonly confirmations?: ToolConfirmationPort
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    for (const value of Object.values(this.options)) {
      if (!Number.isInteger(value) || value <= 0) throw new Error('Invalid agent loop limit.');
    }
  }

  async run(
    request: AgentLoopRequest,
    context: ToolExecutionContext,
    mode: PermissionMode,
    onDelta: (text: string) => void,
    signal: AbortSignal
  ): Promise<AgentLoopResult> {
    const messages = structuredClone(request.messages);
    const executions: AgentToolExecutionEvidence[] = [];
    let previousSignature: string | undefined;

    for (let round = 0; round < this.options.maxRounds; round += 1) {
      signal.throwIfAborted();
      const toolCalls: AgentToolCall[] = [];
      const textDeltas: string[] = [];
      const callIds = new Set<string>();
      const sampling = {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
        ...(request.reasoningPreset !== undefined ? { reasoningPreset: request.reasoningPreset } : {})
      };
      for await (const event of this.provider.streamAgent({
        model: request.model,
        messages: structuredClone(messages),
        tools: this.registry.definitions(),
        ...sampling
      }, signal)) {
        signal.throwIfAborted();
        if (event.type === 'textDelta') {
          if (event.text) textDeltas.push(event.text);
        } else {
          if (toolCalls.length >= this.options.maxCallsPerRound) {
            return blocked('Provider exceeded the tool call limit.', executions);
          }
          if (callIds.has(event.call.id)) return blocked('Provider repeated a tool call id.', executions);
          callIds.add(event.call.id);
          toolCalls.push(structuredClone(event.call));
        }
      }

      if (textDeltas.length > 0 && toolCalls.length > 0) {
        return blocked('Provider mixed text and tool calls in one round.', executions);
      }
      if (toolCalls.length === 0) {
        const finalText = textDeltas.join('');
        if (!finalText) return blocked('Provider returned empty agent output.', executions);
        for (const delta of textDeltas) onDelta(delta);
        return { status: 'completed', finalText, executions };
      }

      const toolMessages: AgentConversationMessage[] = [];
      for (const call of toolCalls) {
        const signature = `${call.name}:${canonicalJson(call.input)}`;
        if (signature === previousSignature) return blocked('Repeated tool call without progress.', executions);
        previousSignature = signature;

        const tool = this.registry.get(call.name);
        if (!tool) return blocked(`Unknown tool: ${bounded(call.name, 128)}`, executions);
        const isRead = tool.risk === 'readOnly' && !tool.mutatesWorkspace;
        const isWorkspaceWrite = tool.risk === 'workspaceWrite' && tool.mutatesWorkspace;
        // processExec (build/test/lint/analysis via the structured runner) is
        // admitted but stays fully permission-gated below: plan denies, other
        // modes require confirmation unless the session grants full access.
        const isProcessExec = tool.risk === 'processExec' && tool.mutatesWorkspace;
        if (!isRead && !isWorkspaceWrite && !isProcessExec) {
          return blocked('Tool is outside the bounded Agent tool scope.', executions);
        }
        const decision = this.permissions.evaluate(mode, {
          risk: tool.risk,
          mutatesWorkspace: tool.mutatesWorkspace
        });
        if (!decision.allowed || decision.outcome === 'deny') {
          return blocked(bounded(decision.reason, this.options.maxErrorCharacters), executions);
        }
        if (decision.needsConfirmation || decision.outcome === 'confirm') {
          if (!this.confirmations) {
            return blocked(bounded(decision.reason, this.options.maxErrorCharacters), executions);
          }
          let approved: boolean;
          try {
            approved = await this.confirmations.confirm({
              callId: call.id,
              toolId: tool.id,
              input: structuredClone(call.input),
              reason: bounded(decision.reason, this.options.maxErrorCharacters)
            }, signal);
            signal.throwIfAborted();
          } catch (error) {
            if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            return blocked('Tool approval could not be completed.', executions);
          }
          if (!approved) return blocked('User declined the proposed workspace action.', executions);
        }

        let content: string;
        let truncated = false;
        let outcome: AgentToolExecutionEvidence['outcome'] = 'succeeded';
        try {
          const result = await tool.execute(call.input, { ...context, signal });
          if (signal.aborted) {
            if (tool.mutatesWorkspace) {
              executions.push({
                callId: call.id,
                toolId: call.name,
                outcome: 'succeeded',
                truncated: false
              });
              return blocked('Run stopped after a workspace change was applied.', executions);
            }
            signal.throwIfAborted();
          }
          const serialized = boundedSuccess(result, this.options.maxResultCharacters);
          content = serialized.content;
          truncated = serialized.truncated;
        } catch (error) {
          if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
          outcome = 'failed';
          content = JSON.stringify({
            ok: false,
            error: bounded(error instanceof Error ? error.message : String(error), this.options.maxErrorCharacters)
          });
        }
        executions.push({ callId: call.id, toolId: call.name, outcome, truncated });
        toolMessages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }
      messages.push({ role: 'assistant', content: '', toolCalls: structuredClone(toolCalls) }, ...toolMessages);
    }
    return blocked('Agent round budget exhausted.', executions);
  }
}

// Compatibility export while callers migrate from the initial read-only slice.
// The loop has since widened to bounded workspace writes and permission-gated
// process execution (see AgentToolLoop).
export { AgentToolLoop as ReadOnlyAgentLoop };

function blocked(reason: string, executions: AgentToolExecutionEvidence[]): AgentLoopResult {
  return { status: 'blocked', finalText: '', executions: [...executions], reason };
}

function bounded(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

function boundedSuccess(result: unknown, maxCharacters: number): { content: string; truncated: boolean } {
  const complete = JSON.stringify({ ok: true, result, truncated: false });
  if (complete.length <= maxCharacters) return { content: complete, truncated: false };
  const source = safeJson(result);
  let low = 0;
  let high = source.length;
  let content = JSON.stringify({ ok: true, preview: '', truncated: true });
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = JSON.stringify({ ok: true, preview: source.slice(0, middle), truncated: true });
    if (candidate.length <= maxCharacters) {
      content = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { content, truncated: true };
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value); } catch { return '[unserializable tool result]'; }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
