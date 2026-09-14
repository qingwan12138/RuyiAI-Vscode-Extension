import { PermissionMode } from '../../domain/session';
import { AgentHookPort } from '../../domain/hookPort';
import { AgentRequest, AgentStreamEvent } from '../../llm/types';
import { PermissionEngine } from '../../permissions/permissionEngine';
import { AgentDeltaListener, AgentLoopRequest, AgentToolEvent, AgentToolLoop, ToolConfirmationPort } from './readOnlyAgentLoop';
import { ToolRegistry } from './toolRegistry';

export class AgentCapabilityError extends Error {
  constructor(message = 'The selected provider does not implement structural tool calling.') {
    super(message);
    this.name = 'AgentCapabilityError';
  }
}

export class AgentLoopBlockedError extends Error {
  constructor(message: string) {
    super(message.slice(0, 240));
    this.name = 'AgentLoopBlockedError';
  }
}

export interface AgentChatSessionContext {
  sessionId: string;
  mode: PermissionMode;
}

/**
 * Resolves one stable workspace-context message for a run (project instructions,
 * skill catalogue). Returns an already-framed system message, or undefined when
 * the workspace has nothing to add. A loader that throws must not fail the run,
 * so implementations resolve to undefined instead.
 */
export type WorkspaceContextLoader = (signal?: AbortSignal) => Promise<string | undefined>;

/** @deprecated Kept as an alias for call sites written before skills existed. */
export type ProjectInstructionsLoader = WorkspaceContextLoader;

interface AgentProviderCandidate {
  streamAgent?(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

export class AgentChatRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissions: Pick<PermissionEngine, 'evaluate'>,
    private readonly workspaceUri: string,
    private readonly confirmations?: ToolConfirmationPort,
    private readonly projectInstructions?: WorkspaceContextLoader,
    private readonly hooks?: AgentHookPort,
    private readonly skillCatalogue?: WorkspaceContextLoader
  ) {}

  async run(
    provider: AgentProviderCandidate,
    request: AgentLoopRequest,
    session: AgentChatSessionContext,
    onDelta: AgentDeltaListener,
    signal: AbortSignal,
    onToolEvent?: (event: AgentToolEvent) => void
  ): Promise<string> {
    if (!provider.streamAgent) throw new AgentCapabilityError();
    const instructions = await this.resolveHeadContext(this.projectInstructions, signal);
    const skillCatalogue = await this.resolveHeadContext(this.skillCatalogue, signal);
    const loopRequest = {
      ...request,
      ...(instructions ? { projectInstructions: instructions } : {}),
      ...(skillCatalogue ? { skillCatalogue } : {})
    };
    const loop = new AgentToolLoop(
      { streamAgent: provider.streamAgent.bind(provider) },
      this.registry,
      this.permissions,
      {},
      this.confirmations,
      this.hooks
    );
    const result = await loop.run(loopRequest, {
      sessionId: session.sessionId,
      workspaceUri: this.workspaceUri,
      signal
    }, session.mode, onDelta, signal, onToolEvent);
    if (result.status === 'blocked') {
      throw new AgentLoopBlockedError(result.reason ?? 'Agent loop blocked without a reason.');
    }
    return result.finalText;
  }

  /**
   * Workspace context is an enhancement, never a reason to lose a run: an empty
   * result is the normal case (a workspace with no AGENTS.md and no skills), and
   * anything else that escapes a loader is treated the same way. Cancellation is
   * different — the caller asked to stop, so it propagates.
   */
  private async resolveHeadContext(
    loader: WorkspaceContextLoader | undefined,
    signal: AbortSignal
  ): Promise<string | undefined> {
    if (!loader) return undefined;
    try {
      const message = await loader(signal);
      return message?.trim() ? message : undefined;
    } catch (error) {
      signal.throwIfAborted();
      return undefined;
    }
  }
}
