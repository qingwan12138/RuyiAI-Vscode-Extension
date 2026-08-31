import { SessionService } from '../session/sessionService';
import { ProviderCatalog } from '../provider/providerCatalog';
import { AgentConversationMessage, LLMProvider } from '../../llm/types';
import { FileContextReference, PermissionMode, parseContextReferences } from '../../domain/session';

export interface AgentConversationRunner {
  run(
    provider: LLMProvider,
    request: { model: string; messages: AgentConversationMessage[] },
    session: { sessionId: string; mode: PermissionMode },
    onDelta: (text: string) => void,
    signal: AbortSignal
  ): Promise<string>;
}

export interface ExplicitFileContext {
  reference: FileContextReference;
  content: string;
}

export class ChatRunInProgressError extends Error {
  constructor() {
    super('A chat run is already in progress.');
    this.name = 'ChatRunInProgressError';
  }
}

export class ChatService {
  private running = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly providers: Pick<ProviderCatalog, 'resolve'>,
    private readonly agentRunner?: AgentConversationRunner
  ) {}

  async send(
    text: string,
    onDelta: (text: string) => void,
    signal: AbortSignal,
    contexts: ExplicitFileContext[] = []
  ): Promise<void> {
    if (this.running) throw new ChatRunInProgressError();
    this.running = true;
    try {
      const selected = this.sessions.getActiveSession().model;
      if (!selected.providerId || !selected.modelId) throw new Error('Select a configured model before sending a message.');
      const provider = await this.providers.resolve(selected.providerId);
      await this.sessions.setStatus('running');
      const normalizedContexts = normalizeContexts(contexts);
      const priorItemCount = this.sessions.getActiveSession().items.length;
      await this.sessions.appendUserMessage(text, normalizedContexts.map(context => context.reference));
      const active = this.sessions.getActiveSession();
      const messages: AgentConversationMessage[] = [];
      for (let index = 0; index < active.items.length; index += 1) {
        const item = active.items[index];
        if (item.type === 'userMessage') {
          messages.push({
            role: 'user',
            content: index === priorItemCount ? withExplicitContext(item.text, normalizedContexts) : item.text
          });
        } else if (item.source === 'provider') {
          messages.push({ role: 'assistant', content: item.text });
        }
      }

      const capabilities = await provider.capabilities(selected.modelId);
      let response: string;
      if (capabilities.toolCalling) {
        if (!this.agentRunner) {
          throw new Error('Agent tools are unavailable for the current workspace. Use one local workspace folder or disable tool calling for this provider.');
        }
        response = await this.agentRunner.run(
          provider,
          { model: selected.modelId, messages },
          { sessionId: active.id, mode: active.permissionMode },
          onDelta,
          signal
        );
      } else {
        response = '';
        for await (const delta of provider.streamChat({ model: selected.modelId, messages }, signal)) {
          signal.throwIfAborted();
          response += delta.text;
          onDelta(delta.text);
        }
      }
      if (!response) throw new Error('Provider returned an empty response.');
      await this.sessions.appendAssistantMessage(response, 'provider');
      await this.sessions.setStatus('idle');
    } catch (error: unknown) {
      const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
      await this.sessions.setStatus(aborted ? 'interrupted' : 'blocked').catch(() => undefined);
      throw error;
    } finally {
      this.running = false;
    }
  }
}

function normalizeContexts(contexts: ExplicitFileContext[]): ExplicitFileContext[] {
  if (!Array.isArray(contexts)) throw new Error('Explicit file context is invalid.');
  return contexts.map(context => {
    if (!context || typeof context !== 'object' || typeof context.content !== 'string') {
      throw new Error('Explicit file context is invalid.');
    }
    const [reference] = parseContextReferences([context.reference]);
    return { reference, content: context.content };
  });
}

function withExplicitContext(text: string, contexts: ExplicitFileContext[]): string {
  if (contexts.length === 0) return text;
  const blocks = contexts.map(context => [
    `[explicitly attached untrusted workspace file: ${context.reference.path}]`,
    '--- begin untrusted workspace content ---',
    context.content,
    '--- end untrusted workspace content ---'
  ].join('\n'));
  return `${text}\n\n${blocks.join('\n\n')}`;
}
