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
import { isWiderPermissionMode } from '../../domain/permissionMode';
import { permissionModeSystemMessage } from './permissionModePrompt';
import { parsePermissionEscalation } from './requestPermissionTool';
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

/** Live tool activity surfaced to the UI so the user sees what the agent did. */
export type AgentToolEvent =
  | { type: 'toolCall'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'toolResult'; id: string; name: string; outcome: 'succeeded' | 'failed'; truncated: boolean; summary: string };

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
  /** Refusals in a row before the run stops and hands control back. */
  maxConsecutiveDenials: number;
  /** Refusals in one run before the run stops and hands control back. */
  maxTotalDenials: number;
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
  maxErrorCharacters: 240,
  // Claude Code escalates to the human after 3 consecutive or 20 total denials;
  // Codex breaks the turn after 3 consecutive or 10-in-50. Yisi has no separate
  // "pause and resume prompting" step, so the stop itself hands back to the user.
  maxConsecutiveDenials: 3,
  maxTotalDenials: 20
};

/** Why a call did not run. The model gets a different reason for each. */
type DenialKind = 'policy' | 'user' | 'unavailable';

const DENIAL_GUIDANCE: Record<DenialKind, string> = {
  policy: 'The permission policy refused this action. Do not look for a way around it. Continue with a materially safer alternative, or explain what you need and let the user switch the permission mode.',
  user: 'The user declined this action. Do not repeat it; ask what they would prefer, or continue without it.',
  unavailable: 'No approval channel was available, so the action failed closed. Do not retry it; tell the user what you need and let them decide.'
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
    signal: AbortSignal,
    onToolEvent?: (event: AgentToolEvent) => void
  ): Promise<AgentLoopResult> {
    // The briefing goes after the retained history, immediately before the current
    // user turn, rather than at the head: the history then stays a byte-identical
    // prefix and a mode change only rewrites the tail. It stays a `system` message
    // so the model cannot mistake it for user input — note the Anthropic
    // transport hoists system messages into its top-level `system` field, so there
    // a mode change still alters the cached prefix.
    const messages = structuredClone(request.messages);
    const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
    messages.splice(lastIsUser ? messages.length - 1 : messages.length, 0, {
      role: 'system',
      content: permissionModeSystemMessage(mode)
    });
    const executions: AgentToolExecutionEvidence[] = [];
    let previousSignature: string | undefined;
    // Denials are tool outcomes, not run failures (docs/04: every reference agent
    // returns the refusal to the model and continues). They are still bounded, so
    // an agent that keeps hitting the boundary hands control back instead of
    // looping until the round budget runs out.
    let consecutiveDenials = 0;
    let totalDenials = 0;
    // A permission change may only follow a refusal by the *policy*. A user who
    // declined does not want a wider mode; asking anyway is nagging, and the
    // reference designs escalate out of a confinement/policy block, not out of a
    // human "no" (docs/04).
    let policyDenials = 0;
    // One escalation request per run, matching the reference designs.
    let escalationRequested = false;

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

      if (toolCalls.length === 0) {
        const finalText = textDeltas.join('');
        if (!finalText) return blocked('Provider returned empty agent output.', executions);
        for (const delta of textDeltas) onDelta(delta);
        return { status: 'completed', finalText, executions };
      }

      // A single model turn may carry text (a preamble) AND tool calls. Keep
      // both: stream the preamble to the user, and attach it as the assistant
      // message content so the model sees its own commentary in the next round.
      const assistantText = textDeltas.join('');
      for (const delta of textDeltas) onDelta(delta);

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
        // environmentChange (Ruyi SDK env mutations) is admitted the same way:
        // plan denies, manual/auto/acceptEdits confirm, fullAccess allows.
        const isEnvironmentChange = tool.risk === 'environmentChange' && tool.mutatesWorkspace;
        if (!isRead && !isWorkspaceWrite && !isProcessExec && !isEnvironmentChange) {
          return blocked('Tool is outside the bounded Agent tool scope.', executions);
        }
        // A refusal is a tool outcome, not a run failure: the model gets a
        // distinguishable reason so it can tell "the policy says no" from "the
        // user said no" from "nobody could answer", and it keeps working. Bounded
        // by a budget, past which the run stops and hands control back.
        const refuse = (kind: DenialKind, rawReason: string): AgentLoopResult | undefined => {
          consecutiveDenials += 1;
          totalDenials += 1;
          if (kind === 'policy') policyDenials += 1;
          const reason = bounded(rawReason, this.options.maxErrorCharacters);
          executions.push({ callId: call.id, toolId: call.name, outcome: 'failed', truncated: false });
          onToolEvent?.({
            type: 'toolResult',
            id: call.id,
            name: call.name,
            outcome: 'failed',
            truncated: false,
            summary: bounded(reason, 600)
          });
          toolMessages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              ok: false,
              denied: true,
              reason: kind,
              error: reason,
              guidance: DENIAL_GUIDANCE[kind]
            })
          });
          if (
            consecutiveDenials >= this.options.maxConsecutiveDenials
            || totalDenials >= this.options.maxTotalDenials
          ) {
            return blocked(
              `Stopped after ${totalDenials} refused action(s), ${consecutiveDenials} of them in a row. `
              + 'Check the permission mode, then tell the agent how to proceed.',
              executions
            );
          }
          return undefined;
        };

        // A permission escalation is a question, not work. It is grounded in a
        // refusal that actually happened, must be strictly wider, is asked at most
        // once per run, and only takes effect once the user approves it — the
        // shape Codex and the DeepSeek Harness both document (docs/04). This is
        // also what gives Plan mode a reviewed exit.
        if (tool.permissionEscalation) {
          const requested = parsePermissionEscalation(call.input);
          if (!requested) {
            const terminal = refuse('policy', 'Malformed permission escalation request.');
            if (terminal) return terminal;
            continue;
          }
          if (escalationRequested) {
            const terminal = refuse('policy', 'A permission change was already requested in this run.');
            if (terminal) return terminal;
            continue;
          }
          if (policyDenials === 0) {
            const terminal = refuse(
              'policy',
              totalDenials === 0
                ? 'A permission change must follow a refusal by the policy, and nothing has been refused in this run yet.'
                : 'A permission change may only follow a refusal by the policy. The user already declined, so do not ask to widen the mode — ask what they would prefer instead.'
            );
            if (terminal) return terminal;
            continue;
          }
          if (!isWiderPermissionMode(mode, requested.mode)) {
            const terminal = refuse(
              'policy',
              `The requested mode ("${requested.mode}") is not strictly wider than the current one ("${mode}").`
            );
            if (terminal) return terminal;
            continue;
          }
          if (!this.confirmations) {
            const terminal = refuse('unavailable', 'No approval channel is available for a permission change.');
            if (terminal) return terminal;
            continue;
          }
          escalationRequested = true;
          let widened: boolean;
          try {
            widened = await this.confirmations.confirm({
              callId: call.id,
              toolId: tool.id,
              input: { mode: requested.mode, justification: requested.justification },
              reason: `Allow this run to continue in "${requested.mode}" mode? ${requested.justification}`
            }, signal);
            signal.throwIfAborted();
          } catch (error) {
            if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            const terminal = refuse('unavailable', 'The permission change could not be asked for.');
            if (terminal) return terminal;
            continue;
          }
          if (!widened) {
            const terminal = refuse('user', 'The user declined the permission change. Do not ask again in this run.');
            if (terminal) return terminal;
            continue;
          }
          // The widening lasts for the rest of this run only; the session's stored
          // mode is not changed.
          mode = requested.mode;
          consecutiveDenials = 0;
          onToolEvent?.({
            type: 'toolResult',
            id: call.id,
            name: call.name,
            outcome: 'succeeded',
            truncated: false,
            summary: `permission widened to ${mode} for this run`
          });
          toolMessages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              ok: true,
              mode,
              note: `The user allowed this run to continue in "${mode}" mode. It applies until this run ends; the session setting is unchanged.`
            })
          });
          continue;
        }

        const decision = this.permissions.evaluate(mode, {
          risk: tool.risk,
          mutatesWorkspace: tool.mutatesWorkspace
        });
        if (!decision.allowed || decision.outcome === 'deny') {
          const terminal = refuse('policy', decision.reason);
          if (terminal) return terminal;
          continue;
        }
        if (decision.needsConfirmation || decision.outcome === 'confirm') {
          if (!this.confirmations) {
            const terminal = refuse('unavailable', decision.reason);
            if (terminal) return terminal;
            continue;
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
            const terminal = refuse('unavailable', 'Tool approval could not be completed.');
            if (terminal) return terminal;
            continue;
          }
          if (!approved) {
            const terminal = refuse('user', 'The user declined the proposed workspace action.');
            if (terminal) return terminal;
            continue;
          }
        }

        let content: string;
        let truncated = false;
        let outcome: AgentToolExecutionEvidence['outcome'] = 'succeeded';
        onToolEvent?.({ type: 'toolCall', id: call.id, name: call.name, input: structuredClone(call.input) });
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
        // A call that actually ran clears the run of refusals, so the consecutive
        // budget only counts a genuine streak.
        if (outcome === 'succeeded') consecutiveDenials = 0;
        onToolEvent?.({
          type: 'toolResult',
          id: call.id,
          name: call.name,
          outcome,
          truncated,
          summary: bounded(content, 600)
        });
        toolMessages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }
      messages.push({ role: 'assistant', content: assistantText, toolCalls: structuredClone(toolCalls) }, ...toolMessages);
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
