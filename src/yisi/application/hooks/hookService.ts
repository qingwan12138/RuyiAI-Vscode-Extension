import { HookDecision, AgentHookPort, ToolHookOutcome, ToolHookRequest, ToolHookResult } from '../../domain/hookPort';
import { ConfiguredHook, hookMatchesTool } from './hookConfiguration';

/**
 * Runs the configured hooks for a tool call.
 *
 * Order and failure semantics are deliberately simple:
 *  - hooks run **sequentially** in configuration order, so behaviour is
 *    deterministic and a slow guardrail cannot be raced by a second one;
 *  - **the first `deny` wins** for pre-tool hooks — there is nothing to gain from
 *    asking the remaining hooks once the action is already refused;
 *  - post-tool hooks all run and their context accumulates: after the fact, a
 *    second opinion is useful rather than redundant;
 *  - a hook that cannot run follows its own `onError` policy, and the failure is
 *    **always visible** (as the denial reason, or as context) — a guardrail that
 *    silently stopped guarding is the failure mode worth avoiding.
 *
 * The service never decides whether an action is *permitted*. It reports a
 * refusal or adds context; PermissionEngine still runs for every call.
 */

export interface HookExecutionResult {
  decision?: HookDecision;
  reason?: string;
  context?: string;
  /** Set when the hook could not run or produced unusable output. */
  error?: string;
}

export interface HookExecutor {
  execute(hook: ConfiguredHook, payload: unknown, signal: AbortSignal): Promise<HookExecutionResult>;
}

const MAX_CONTEXT_CHARACTERS = 8_000;
const MAX_REASON_CHARACTERS = 600;

export class HookService implements AgentHookPort {
  constructor(
    private readonly hooks: readonly ConfiguredHook[],
    private readonly executor: HookExecutor
  ) {}

  get isEmpty(): boolean {
    return this.hooks.length === 0;
  }

  async preToolUse(request: ToolHookRequest, signal: AbortSignal): Promise<ToolHookResult> {
    const contexts: string[] = [];
    for (const hook of this.matching(request.toolId, 'preToolUse')) {
      const result = await this.run(hook, { event: 'preToolUse', ...describe(request) }, signal);
      if (result.error) {
        const notice = `Hook "${label(hook)}" could not run: ${result.error}`;
        if (hook.onError === 'block') {
          return { decision: 'deny', reason: bound(notice, MAX_REASON_CHARACTERS), hook: label(hook) };
        }
        // Explicitly configured to let the action through; the failure still has
        // to be visible, so it is carried as context rather than swallowed.
        contexts.push(notice);
        continue;
      }
      if (result.context) contexts.push(result.context);
      if (result.decision === 'deny') {
        return {
          decision: 'deny',
          reason: bound(result.reason ?? `Hook "${label(hook)}" denied this action.`, MAX_REASON_CHARACTERS),
          hook: label(hook),
          ...(contexts.length ? { context: bound(contexts.join('\n\n'), MAX_CONTEXT_CHARACTERS) } : {})
        };
      }
    }
    return {
      decision: 'allow',
      ...(contexts.length ? { context: bound(contexts.join('\n\n'), MAX_CONTEXT_CHARACTERS) } : {})
    };
  }

  async postToolUse(request: ToolHookOutcome, signal: AbortSignal): Promise<ToolHookResult> {
    const contexts: string[] = [];
    for (const hook of this.matching(request.toolId, 'postToolUse')) {
      const result = await this.run(hook, { event: 'postToolUse', ...describe(request) }, signal);
      if (result.error) {
        contexts.push(`Hook "${label(hook)}" could not run: ${result.error}`);
        continue;
      }
      // A post-tool hook cannot un-run the action, so a "deny" is reported as
      // context: the useful information is *why* it objected, not a veto that
      // would be a lie.
      if (result.decision === 'deny') {
        contexts.push(result.reason ?? `Hook "${label(hook)}" objected to this action.`);
        continue;
      }
      if (result.context) contexts.push(result.context);
    }
    return {
      decision: 'allow',
      ...(contexts.length ? { context: bound(contexts.join('\n\n'), MAX_CONTEXT_CHARACTERS) } : {})
    };
  }

  private matching(toolId: string, event: 'preToolUse' | 'postToolUse'): ConfiguredHook[] {
    return this.hooks.filter(hook => hook.event === event && hookMatchesTool(hook.match, toolId));
  }

  private async run(hook: ConfiguredHook, payload: unknown, signal: AbortSignal): Promise<HookExecutionResult> {
    if (signal.aborted) return { error: 'The run was cancelled.' };
    try {
      return await this.executor.execute(hook, payload, signal);
    } catch (error) {
      if (signal.aborted) return { error: 'The run was cancelled.' };
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function describe(request: ToolHookRequest): Record<string, unknown> {
  return {
    tool: { id: request.toolId, risk: request.risk, mutatesWorkspace: request.mutatesWorkspace },
    input: request.input,
    sessionId: request.sessionId,
    ...('outcome' in request
      ? { outcome: (request as ToolHookOutcome).outcome, result: (request as ToolHookOutcome).result }
      : {})
  };
}

function label(hook: ConfiguredHook): string {
  const args = hook.args.length ? ` ${hook.args.join(' ')}` : '';
  return `${hook.command}${args}`;
}

function bound(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}
