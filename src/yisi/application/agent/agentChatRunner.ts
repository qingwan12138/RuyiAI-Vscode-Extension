import { PermissionMode } from '../../domain/session';
import { AgentRequest, AgentStreamEvent } from '../../llm/types';
import { PermissionEngine } from '../../permissions/permissionEngine';
import { AgentLoopRequest, ReadOnlyAgentLoop } from './readOnlyAgentLoop';
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

interface AgentProviderCandidate {
  streamAgent?(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

export class AgentChatRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissions: Pick<PermissionEngine, 'evaluate'>,
    private readonly workspaceUri: string
  ) {}

  async run(
    provider: AgentProviderCandidate,
    request: AgentLoopRequest,
    session: AgentChatSessionContext,
    onDelta: (text: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    if (!provider.streamAgent) throw new AgentCapabilityError();
    const loop = new ReadOnlyAgentLoop(
      { streamAgent: provider.streamAgent.bind(provider) },
      this.registry,
      this.permissions
    );
    const result = await loop.run(request, {
      sessionId: session.sessionId,
      workspaceUri: this.workspaceUri,
      signal
    }, session.mode, onDelta, signal);
    if (result.status === 'blocked') {
      throw new AgentLoopBlockedError(result.reason ?? 'Agent loop blocked without a reason.');
    }
    return result.finalText;
  }
}
