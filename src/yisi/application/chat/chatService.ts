import { SessionService } from '../session/sessionService';
import { ProviderCatalog } from '../provider/providerCatalog';
import { AgentConversationMessage, ChatMessage, LLMProvider, RequestSampling } from '../../llm/types';
import { ConversationItem, FileContextReference, PermissionMode, parseContextReferences } from '../../domain/session';
import { AttachmentContext } from '../../context/attachment/attachmentTypes';
import { AttachmentRehydrator } from '../attachment/attachmentService';
import { IdentityQuestionPolicy, isIdentityQuestion } from './identityQuestion';
import { assembleAttachmentContexts, computeAttachmentBudget } from './attachmentPrompt';

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
  attachment: AttachmentContext;
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
    private readonly agentRunner?: AgentConversationRunner,
    private readonly identityQuestions?: () => IdentityQuestionPolicy,
    private readonly rehydrator?: AttachmentRehydrator
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
      // Identity questions go to the bare chat endpoint with no tools and no
      // history — byte-for-byte the raw API call — because agent-tuned models
      // otherwise role-play a different persona inside the tool loop. Normal
      // messages are never routed this way.
      const identityBypass = normalizedContexts.length === 0
        && isIdentityQuestion(text, this.identityQuestions?.());
      let messages: AgentConversationMessage[];
      let response: string;
      if (identityBypass) {
        messages = [{ role: 'user', content: text }];
        response = await streamChatText(provider, selected.modelId, messages, undefined, onDelta, signal);
      } else {
        const capabilities = await provider.capabilities(selected.modelId);
        const sampling = {
          ...(selected.temperature !== undefined ? { temperature: selected.temperature } : {}),
          ...(selected.maxTokens !== undefined ? { maxTokens: selected.maxTokens } : {}),
          ...(selected.reasoningEffort !== undefined ? { reasoningPreset: selected.reasoningEffort } : {})
        };
        const attachmentBudget = computeAttachmentBudget(
          capabilities.maxContextTokens,
          historyText(active.items, priorItemCount),
          text
        );
        const rehydrated = await this.rehydratePriorContexts(active.items, priorItemCount, signal);
        messages = historyMessages(active.items, priorItemCount, normalizedContexts, attachmentBudget, rehydrated);
        if (capabilities.toolCalling) {
          if (!this.agentRunner) {
            throw new Error('Agent tools are unavailable for the current workspace. Use one local workspace folder or disable tool calling for this provider.');
          }
          response = await this.agentRunner.run(
            provider,
            { model: selected.modelId, messages, ...sampling },
            { sessionId: active.id, mode: active.permissionMode },
            onDelta,
            signal
          );
        } else {
          response = await streamChatText(provider, selected.modelId, messages, sampling, onDelta, signal);
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

  /** Re-reads attachments stored on earlier user messages so they stay
   * referenceable in later turns. Indexed by message index; the current turn
   * (priorItemCount) is skipped because it carries fresh in-memory context. */
  private async rehydratePriorContexts(
    items: ConversationItem[],
    priorItemCount: number,
    signal: AbortSignal
  ): Promise<Map<number, AttachmentContext[]>> {
    const rehydrated = new Map<number, AttachmentContext[]>();
    if (!this.rehydrator) return rehydrated;
    for (let index = 0; index < items.length; index += 1) {
      if (index === priorItemCount) continue;
      const item = items[index];
      if (item.type !== 'userMessage' || !item.contexts || item.contexts.length === 0) continue;
      const attachments: AttachmentContext[] = [];
      for (const reference of item.contexts) {
        signal.throwIfAborted();
        const attachment = await this.rehydrator.rehydrate(reference, signal);
        if (attachment) attachments.push(attachment);
      }
      if (attachments.length > 0) rehydrated.set(index, attachments);
    }
    return rehydrated;
  }
}

function normalizeContexts(contexts: ExplicitFileContext[]): ExplicitFileContext[] {
  if (!Array.isArray(contexts)) throw new Error('Explicit file context is invalid.');
  return contexts.map(context => {
    if (!context || typeof context !== 'object' || !isAttachmentContext(context.attachment)) {
      throw new Error('Explicit file context is invalid.');
    }
    const [reference] = parseContextReferences([context.reference]);
    return { reference, attachment: context.attachment };
  });
}

function isAttachmentContext(value: unknown): value is AttachmentContext {
  return typeof value === 'object' && value !== null
    && typeof (value as AttachmentContext).id === 'string'
    && typeof (value as AttachmentContext).fileName === 'string'
    && Array.isArray((value as AttachmentContext).chunks);
}

function withExplicitContext(text: string, attachments: AttachmentContext[], budgetTokens: number): string {
  if (attachments.length === 0) return text;
  const block = assembleAttachmentContexts(attachments, budgetTokens);
  if (!block) return text;
  return `${text}\n\nAttached context:\n${block}`;
}

function historyMessages(
  items: ConversationItem[],
  priorItemCount: number,
  contexts: ExplicitFileContext[],
  budgetTokens: number,
  rehydrated: Map<number, AttachmentContext[]>
): AgentConversationMessage[] {
  const messages: AgentConversationMessage[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'userMessage') {
      let content = item.text;
      if (index === priorItemCount) {
        content = withExplicitContext(item.text, contexts.map(context => context.attachment), budgetTokens);
      } else {
        const prior = rehydrated.get(index);
        if (prior && prior.length > 0) {
          content = withExplicitContext(item.text, prior, budgetTokens);
        }
      }
      messages.push({ role: 'user', content });
    } else if (item.source === 'provider') {
      messages.push({ role: 'assistant', content: item.text });
    }
  }
  return messages;
}

// Prior conversation text (everything before the current user message) used to
// estimate how much of the context window is already consumed.
function historyText(items: ConversationItem[], priorItemCount: number): string {
  const parts: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'userMessage') {
      if (index !== priorItemCount) parts.push(item.text);
    } else if (item.source === 'provider') {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

async function streamChatText(
  provider: LLMProvider,
  model: string,
  messages: readonly ChatMessage[],
  sampling: RequestSampling | undefined,
  onDelta: (text: string) => void,
  signal: AbortSignal
): Promise<string> {
  let response = '';
  for await (const delta of provider.streamChat({ model, messages: [...messages], ...sampling }, signal)) {
    signal.throwIfAborted();
    response += delta.text;
    onDelta(delta.text);
  }
  return response;
}
