import { ToolRisk } from './tool';

/**
 * Hook port shapes.
 *
 * Clean-room note: the *behaviour* was studied from the published documentation
 * of Claude Code and Codex (docs/04) — hooks are user-configured scripts that run
 * at lifecycle events, where a pre-tool hook can block an action and a post-tool
 * hook can feed its output back to the model. No implementation, config format or
 * prompt text was copied; the shapes below are Yisi's own.
 *
 * ## The one invariant that matters
 *
 * **A hook may only ever tighten.** There is deliberately no way for a hook, or
 * for the configuration that declares it, to make an action *more* allowed:
 *
 *  - the decision vocabulary is `allow` (no objection) or `deny` (block) —
 *    there is no "approve" verdict to express;
 *  - `allow` does not skip anything: the permission engine and the approval card
 *    still run afterwards, exactly as they would without a hook;
 *  - therefore a hook cannot become a way around the permission model, and a
 *    repository that ships `.vscode/settings.json` cannot loosen the gate.
 *
 * That is a deliberate difference from the reference behaviour, where a hook
 * returning "allow" suppresses the permission prompt. Yisi's rule is that
 * PermissionEngine is the only thing that decides (AGENTS.md §2).
 */

export type HookEvent = 'preToolUse' | 'postToolUse';

/** What a hook may answer. Not `approve`: see the invariant above. */
export type HookDecision = 'allow' | 'deny';

/** What to do when a hook cannot run (spawn failure, timeout, bad output). */
export type HookFailurePolicy = 'block' | 'continue';

export interface ToolHookRequest {
  toolId: string;
  risk: ToolRisk;
  mutatesWorkspace: boolean;
  input: Readonly<Record<string, unknown>>;
  sessionId: string;
}

export interface ToolHookOutcome extends ToolHookRequest {
  outcome: 'succeeded' | 'failed';
  /** Bounded representation of what the tool produced, for the hook to inspect. */
  result: string;
}

export interface ToolHookResult {
  decision: HookDecision;
  /** Why the hook denied, shown to the model. */
  reason?: string;
  /** Context a hook wants the model to read (post-tool feedback, e.g. lint output). */
  context?: string;
  /** Which configured hook decided, for messages and diagnostics. */
  hook?: string;
}

export interface AgentHookPort {
  preToolUse(request: ToolHookRequest, signal: AbortSignal): Promise<ToolHookResult>;
  postToolUse(request: ToolHookOutcome, signal: AbortSignal): Promise<ToolHookResult>;
}
