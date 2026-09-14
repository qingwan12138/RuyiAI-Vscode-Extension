import { PermissionMode } from '../../domain/session';
import { ToolExecutionContext, ToolRisk } from '../../domain/tool';
import { AgentHookPort } from '../../domain/hookPort';
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
import { agentSystemPromptMessage } from './agentSystemPrompt';
import { parsePermissionEscalation } from './requestPermissionTool';
import { buildPlanDocument } from './planReview';
import { SubagentTask, SUBAGENT_REPORT_CHARACTERS, parseSubagentTask, subagentBrief } from './subagentTool';
import { ToolRegistry } from './toolRegistry';

export interface AgentLoopRequest extends RequestSampling {
  model: string;
  messages: AgentConversationMessage[];
  /**
   * The workspace's project instructions (AGENTS.md family), already bounded and
   * framed by application/agent/projectInstructions. Absent for workspaces that
   * have none. They are workspace content, so they only inform the model — the
   * permission engine still decides every call.
   */
  projectInstructions?: string;
  /**
   * The bounded list of workspace skills (application/skills). Descriptions are
   * what every run pays for; a body is only read when the model calls the `skill`
   * tool. Also workspace content, with the same limits.
   */
  skillCatalogue?: string;
  /**
   * Present only for a subagent run: who the child is working for, and the three
   * rules it gets wrong otherwise (it cannot ask the user, it can only observe,
   * only its report travels back). See application/agent/subagentTool.
   */
  subagentBrief?: string;
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
  | {
      type: 'toolResult';
      id: string;
      name: string;
      outcome: 'succeeded' | 'failed';
      truncated: boolean;
      /** One-line label for the collapsed step row. */
      summary: string;
      /** Fuller result for the expanded step body; absent when there is nothing more to show. */
      detail?: string;
    };

export interface AgentLoopResult {
  status: 'completed' | 'blocked';
  finalText: string;
  executions: AgentToolExecutionEvidence[];
  reason?: string;
}

/**
 * Receives streamed model output. `kind` separates the answer text from the
 * model's thinking trace: the trace is a UI affordance only, never conversation
 * content, and callers that do not care can ignore the second argument.
 */
export type AgentDeltaListener = (text: string, kind?: 'text' | 'reasoning') => void;

export interface ReadOnlyAgentLoopOptions {
  maxRounds: number;
  maxCallsPerRound: number;
  maxResultCharacters: number;
  maxErrorCharacters: number;
  /** Refusals in a row before the run stops and hands control back. */
  maxConsecutiveDenials: number;
  /** Refusals in one run before the run stops and hands control back. */
  maxTotalDenials: number;
  /** Subagents one run may spawn. Bounded so a fan-out cannot run away. */
  maxSubagents: number;
  /** Round budget for a single subagent. */
  subagentMaxRounds: number;
}

interface AgentToolProvider {
  streamAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

export interface ToolConfirmationRequest {
  callId: string;
  toolId: string;
  /** Risk class the engine evaluated, so an approver never has to guess. */
  risk: ToolRisk;
  input: Record<string, unknown>;
  reason: string;
  /**
   * Markdown for the user to review and comment on, when the tool is Plan mode's
   * reviewed exit. It is rendered as a document; the card remains the decision.
   */
  planDocument?: string;
}

/**
 * What the user decided, plus anything they left in the review document. Ports
 * may still return a plain boolean — nothing that only approves or declines has to
 * know about feedback.
 */
export interface ToolConfirmationDecision {
  approved: boolean;
  /** Inline comments from the plan document, when there were any. */
  feedback?: string;
}

export interface ToolConfirmationPort {
  confirm(request: ToolConfirmationRequest, signal: AbortSignal): Promise<boolean | ToolConfirmationDecision>;
}

/**
 * How much of a tool result the expandable step body carries. The collapsed row
 * uses a much smaller bound, so inspecting a step is opt-in.
 */
const DETAIL_CHARACTERS = 8_000;

const DEFAULT_OPTIONS: ReadOnlyAgentLoopOptions = {
  maxRounds: 8,
  maxCallsPerRound: 16,
  maxResultCharacters: 65_536,
  maxErrorCharacters: 240,
  // Claude Code escalates to the human after 3 consecutive or 20 total denials;
  // Codex breaks the turn after 3 consecutive or 10-in-50. Yisi has no separate
  // "pause and resume prompting" step, so the stop itself hands back to the user.
  maxConsecutiveDenials: 3,
  maxTotalDenials: 20,
  // A subagent exists to keep big intermediate output out of the parent context,
  // so the budget is deliberately small: a handful of focused explorations, each
  // with fewer rounds than the parent run.
  maxSubagents: 4,
  subagentMaxRounds: 6
};

/**
 * Why a call did not run. The model gets a different reason for each.
 *
 * `hook` is separate from `policy` on purpose: a configured hook is an orthogonal
 * gate, so widening the permission mode cannot lift it. Keeping them apart is what
 * stops the model from asking for an escalation that could never help.
 */
type DenialKind = 'policy' | 'user' | 'unavailable' | 'hook';

const DENIAL_GUIDANCE: Record<DenialKind, string> = {
  policy: 'The permission policy refused this action. Do not look for a way around it. Continue with a materially safer alternative, or explain what you need and let the user switch the permission mode.',
  hook: 'A hook configured in this workspace refused this action. It is not a permission-mode decision, so changing the mode will not lift it. Do not look for a way around it: report what the hook said and let the user adjust the hook or choose a different approach.',
  user: 'The user declined this action. Do not repeat it; ask what they would prefer, or continue without it.',
  unavailable: 'No approval channel was available, so the action failed closed. Do not retry it; tell the user what you need and let them decide.'
};

/** Bound on the extra text a post-tool hook may add to a tool result. */
const HOOK_CONTEXT_CHARACTERS = 4_000;

/** Bound on inline plan comments carried back to the model. */
const PLAN_FEEDBACK_CHARACTERS = 2_000;

export class AgentToolLoop {
  private readonly options: ReadOnlyAgentLoopOptions;

  constructor(
    private readonly provider: AgentToolProvider,
    private readonly registry: ToolRegistry,
    private readonly permissions: Pick<PermissionEngine, 'evaluate'>,
    options: Partial<ReadOnlyAgentLoopOptions> = {},
    private readonly confirmations?: ToolConfirmationPort,
    /**
     * User-configured hooks. They can only ever tighten: a `deny` refuses the
     * call, while `allow` still leaves the permission engine and the approval
     * card untouched (domain/hookPort).
     */
    private readonly hooks?: AgentHookPort
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
    onDelta: AgentDeltaListener,
    signal: AbortSignal,
    onToolEvent?: (event: AgentToolEvent) => void
  ): Promise<AgentLoopResult> {
    // The head messages are the agent's role/tool-use policy and the workspace
    // context (project instructions, then the skill catalogue): all stable, so a
    // provider's prompt cache can reuse them. The mode-specific briefing is
    // appended after the retained history instead (below), so a mode change only
    // rewrites the tail. Note the Anthropic transport hoists system messages into
    // its top-level `system` field, so there both still form the cached prefix.
    const messages = structuredClone(request.messages);
    const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
    messages.splice(lastIsUser ? messages.length - 1 : messages.length, 0, {
      role: 'system',
      content: permissionModeSystemMessage(mode)
    });
    const head: AgentConversationMessage[] = [{ role: 'system', content: agentSystemPromptMessage() }];
    const subagentBriefText = request.subagentBrief?.trim();
    if (subagentBriefText) head.push({ role: 'system', content: subagentBriefText });
    const projectInstructions = request.projectInstructions?.trim();
    if (projectInstructions) head.push({ role: 'system', content: projectInstructions });
    const skillCatalogue = request.skillCatalogue?.trim();
    if (skillCatalogue) head.push({ role: 'system', content: skillCatalogue });
    messages.unshift(...head);
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
    // Subagents are bounded per run: the guard stops the run rather than silently
    // refusing, so the model cannot keep asking for more workers.
    let subagentsSpawned = 0;

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
        } else if (event.type === 'reasoningDelta') {
          // Forwarded the moment it arrives, not buffered to the end of the round:
          // a thinking trace is only useful while it is happening. It cannot affect
          // the round's outcome, and it is never added to `messages`.
          if (event.text) onDelta(event.text, 'reasoning');
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
        // `network` is its own axis, not a sibling of workspace-write (docs/14): a
        // search or a fetch does not change the workspace, so it is admitted
        // regardless of that flag and the engine decides — plan denies it, the other
        // modes confirm it, Full Access allows it. Without this, a networking tool
        // would be refused as "outside the bounded scope", which would make the
        // network declaration in a settings file look like a broken tool instead of
        // a permission decision the user can make.
        const isNetwork = tool.risk === 'network';
        if (!isRead && !isWorkspaceWrite && !isProcessExec && !isEnvironmentChange && !isNetwork) {
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
            summary: bounded(reason, 600),
            detail: bounded(reason, DETAIL_CHARACTERS)
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
          let decision: ToolConfirmationDecision;
          try {
            const answer = await this.confirmations.confirm({
              callId: call.id,
              toolId: tool.id,
              risk: tool.risk,
              input: { mode: requested.mode, justification: requested.justification },
              reason: `Allow this run to continue in "${requested.mode}" mode? ${requested.justification}`,
              // Plan mode's reviewed exit: the plan is opened as a document the
              // user can read and comment on while deciding.
              ...(requested.plan
                ? { planDocument: buildPlanDocument({ plan: requested.plan, mode: requested.mode, justification: requested.justification }) }
                : {})
            }, signal);
            signal.throwIfAborted();
            decision = typeof answer === 'boolean' ? { approved: answer } : answer;
          } catch (error) {
            if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            const terminal = refuse('unavailable', 'The permission change could not be asked for.');
            if (terminal) return terminal;
            continue;
          }
          // Comments the user left in the plan document are guidance for the model
          // and nothing more: they never widen or narrow what the engine allows.
          const planFeedback = decision.feedback?.trim()
            ? bounded(decision.feedback, PLAN_FEEDBACK_CHARACTERS)
            : undefined;
          if (!decision.approved) {
            const terminal = refuse(
              'user',
              planFeedback
                ? `The user declined the permission change. Do not ask again in this run. Comments they left in the plan:\n${planFeedback}`
                : 'The user declined the permission change. Do not ask again in this run.'
            );
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
              note: `The user allowed this run to continue in "${mode}" mode. It applies until this run ends; the session setting is unchanged.`,
              // The plan they reviewed, plus whatever they changed in it.
              ...(planFeedback
                ? { planFeedback: `The user commented on the plan. Follow it:\n${planFeedback}` }
                : {})
            })
          });
          continue;
        }

        // Configured hooks run first, because their whole point is to stop an
        // action before it happens (the documented guardrail use). A hook can only
        // refuse or annotate — it cannot approve anything, so the engine below
        // still runs for every call.
        let preHookContext: string | undefined;
        if (this.hooks) {
          const hookResult = await this.hooks.preToolUse(
            {
              toolId: tool.id,
              risk: tool.risk,
              mutatesWorkspace: tool.mutatesWorkspace,
              input: structuredClone(call.input),
              sessionId: context.sessionId
            },
            signal
          );
          // Stop must win over a hook verdict: a cancelled run reports cancelled.
          signal.throwIfAborted();
          if (hookResult.decision === 'deny') {
            // Deliberately not counted as a policy denial: widening the mode could
            // never lift a hook, so it must not unlock an escalation request.
            const terminal = refuse('hook', hookResult.reason ?? 'A configured hook denied this action.');
            if (terminal) return terminal;
            continue;
          }
          if (hookResult.context) preHookContext = hookResult.context;
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
            const answer = await this.confirmations.confirm({
              callId: call.id,
              toolId: tool.id,
              risk: tool.risk,
              input: structuredClone(call.input),
              reason: bounded(decision.reason, this.options.maxErrorCharacters)
            }, signal);
            signal.throwIfAborted();
            approved = typeof answer === 'boolean' ? answer : answer.approved;
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

        // A subagent is gated exactly like any other tool (hooks, engine, approval)
        // — only its *body* is different, so it keeps the same abort handling,
        // result bounding, step events and post-hooks as everything else.
        if (tool.spawnsSubagent && subagentsSpawned >= this.options.maxSubagents) {
          return blocked(
            `Subagent budget exhausted: this run may spawn ${this.options.maxSubagents}. `
            + 'Finish with what the subagents have already reported.',
            executions
          );
        }

        let content: string;
        let truncated = false;
        let outcome: AgentToolExecutionEvidence['outcome'] = 'succeeded';
        onToolEvent?.({ type: 'toolCall', id: call.id, name: call.name, input: structuredClone(call.input) });
        try {
          const result = tool.spawnsSubagent
            ? await this.runSubagent(parseSubagentTask(call.input), request, context, mode, signal, onToolEvent)
            : await tool.execute(call.input, { ...context, signal });
          if (tool.spawnsSubagent) subagentsSpawned += 1;
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
        // Post-tool hooks run whether the tool succeeded or failed: "the edit went
        // through, but the linter now complains" is exactly the feedback worth
        // handing back. Their text is attached to the result the model reads.
        const hookContext: string[] = [];
        if (preHookContext) hookContext.push(preHookContext);
        if (this.hooks) {
          const postResult = await this.hooks.postToolUse(
            {
              toolId: tool.id,
              risk: tool.risk,
              mutatesWorkspace: tool.mutatesWorkspace,
              input: structuredClone(call.input),
              sessionId: context.sessionId,
              outcome,
              result: bounded(content, DETAIL_CHARACTERS)
            },
            signal
          );
          signal.throwIfAborted();
          if (postResult.context) hookContext.push(postResult.context);
        }
        if (hookContext.length) content = withHookContext(content, hookContext.join('\n\n'));

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
          // `summary` labels the collapsed row; `detail` fills the expanded body,
          // so a step can be inspected without flooding the default view.
          summary: bounded(content, 600),
          detail: bounded(content, DETAIL_CHARACTERS)
        });
        toolMessages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }
      messages.push({ role: 'assistant', content: assistantText, toolCalls: structuredClone(toolCalls) }, ...toolMessages);
    }
    return blocked('Agent round budget exhausted.', executions);
  }
  /**
   * Runs one subagent and returns only its report.
   *
   * The child gets a **filtered registry** — read-only observers only, with the
   * escalation tool and this tool itself removed. That filter is what makes "a
   * subagent can never exceed its parent's permissions" structural: there is no
   * privileged tool for it to call. It receives the workspace context (project
   * instructions, skill catalogue) and the task, but **not** the parent's
   * conversation: isolation is the point.
   *
   * Its tool activity is forwarded so the user can see work happening, but its
   * prose is not: the report is the only thing that crosses back.
   */
  private async runSubagent(
    task: SubagentTask,
    request: AgentLoopRequest,
    context: ToolExecutionContext,
    mode: PermissionMode,
    signal: AbortSignal,
    onToolEvent?: (event: AgentToolEvent) => void
  ): Promise<{ ok: boolean; subagent: string; toolCalls: number; report: string; stopped?: string }> {
    const registry = this.registry.subset(
      tool =>
        tool.risk === 'readOnly'
        && !tool.mutatesWorkspace
        && !tool.permissionEscalation
        && !tool.spawnsSubagent
    );
    const child = new AgentToolLoop(
      this.provider,
      registry,
      this.permissions,
      { ...this.options, maxRounds: this.options.subagentMaxRounds },
      this.confirmations,
      this.hooks
    );
    const result = await child.run(
      {
        model: request.model,
        messages: [{ role: 'user', content: task.prompt }],
        ...(request.projectInstructions ? { projectInstructions: request.projectInstructions } : {}),
        ...(request.skillCatalogue ? { skillCatalogue: request.skillCatalogue } : {}),
        subagentBrief: subagentBrief(task)
      },
      { ...context, signal },
      mode,
      () => undefined,
      signal,
      onToolEvent ? event => onToolEvent(prefixSubagentEvent(task, event)) : undefined
    );
    return {
      ok: result.status === 'completed',
      subagent: task.description,
      toolCalls: result.executions.length,
      report: bounded(result.finalText, SUBAGENT_REPORT_CHARACTERS),
      ...(result.status === 'blocked'
        ? { stopped: bounded(result.reason ?? 'The subagent stopped without a reason.', 400) }
        : {})
    };
  }
}

/**
 * Namespaces a child's step events so they read as the subagent's work and cannot
 * collide with the parent's call ids in the transcript.
 */
function prefixSubagentEvent(task: SubagentTask, event: AgentToolEvent): AgentToolEvent {
  return {
    ...event,
    id: `subagent:${task.description}:${event.id}`,
    name: `${task.description} → ${event.name}`
  };
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

/**
 * Attaches hook text to a serialized tool result. The result is JSON the model
 * reads, so the extra text goes in as a field rather than appended raw text that
 * would leave the payload unparseable.
 */
function withHookContext(content: string, context: string): string {
  const boundedContext = bounded(context, HOOK_CONTEXT_CHARACTERS);
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...(parsed as Record<string, unknown>), hookContext: boundedContext });
    }
  } catch {
    // Fall through to the wrapper form below.
  }
  return JSON.stringify({ ok: true, result: content, hookContext: boundedContext });
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
