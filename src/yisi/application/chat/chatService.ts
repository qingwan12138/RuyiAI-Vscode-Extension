import { SessionService } from '../session/sessionService';
import { ProviderCatalog } from '../provider/providerCatalog';
import { AgentConversationMessage, ChatMessage, LLMProvider, MessageContent, RequestSampling } from '../../llm/types';
import { ConversationItem, FileContextReference, PermissionMode, parseContextReferences } from '../../domain/session';
import { AttachmentContext, AttachmentImagePayload } from '../../context/attachment/attachmentTypes';
import { AttachmentRehydrator } from '../attachment/attachmentService';
import { IdentityQuestionPolicy, isIdentityQuestion } from './identityQuestion';
import { createSecretRedactor } from '../security/secretRedactor';
import {
  SessionAutoTitlePolicy,
  buildSessionTitleMessages,
  parseSessionTitle,
  shouldGenerateSessionTitle
} from './sessionTitle';
import { assembleAttachmentContexts, computeAttachmentBudget } from './attachmentPrompt';
import { AgentToolEvent } from '../agent/readOnlyAgentLoop';
import type { AgentDeltaListener } from '../agent/readOnlyAgentLoop';
import { compactHistory, CompactableMessage } from '../context/contextCompactor';
import { estimateTokens, CONTEXT_OVERHEAD_TOKENS } from '../context/contextUsage';
import { parseSkillInvocation, withSkillContext } from '../skills/skillService';
import { CheckpointTurnStarter } from '../edit/checkpointStore';

export interface AgentConversationRunner {
  run(
    provider: LLMProvider,
    request: { model: string; messages: AgentConversationMessage[] },
    session: { sessionId: string; mode: PermissionMode },
    onDelta: AgentDeltaListener,
    signal: AbortSignal,
    onToolEvent?: (event: AgentToolEvent) => void
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

export interface ChatServiceOptions {
  /**
   * Session auto-titling policy. Absent means "do not auto-title": the title
   * costs one extra provider request per session, so the composition root has to
   * opt in explicitly (this keeps every existing call site unchanged).
   */
  autoTitle?: () => SessionAutoTitlePolicy;
  /**
   * Context window for a model whose provider does not declare one, from the same
   * known-family estimate the context gauge uses. Without this, compaction only
   * happened for providers that declare `maxContextTokens` — so the ring could
   * show "80% used" while nothing ever compacted, and a long session would fail
   * on overflow exactly where v0.7's DoD promised it would not.
   *
   * The declaration always wins; an unknown model still returns undefined, which
   * means "do not compact" (the previous behaviour).
   */
  contextWindow?: (providerId: string, modelId: string) => number | undefined;
}

/**
 * Loads a workspace skill invoked as `/name` in the composer. Returning undefined
 * means "not a skill", and the message is sent exactly as the user typed it — so
 * a leading slash that is not a known skill (a path, or a command nobody defined)
 * never silently disappears.
 */
export interface SkillInvoker {
  load(name: string, signal: AbortSignal): Promise<{ name: string; body: string } | undefined>;
}

export class ChatService {
  private running = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly providers: Pick<ProviderCatalog, 'resolve'>,
    private readonly agentRunner?: AgentConversationRunner,
    private readonly identityQuestions?: () => IdentityQuestionPolicy,
    private readonly rehydrator?: AttachmentRehydrator,
    private readonly sessionRunner?: (session: { sessionId: string; mode: PermissionMode }) => Promise<AgentConversationRunner | undefined>,
    private readonly historyBudgetRatio = 0.6,
    private readonly options: ChatServiceOptions = {},
    private readonly skills?: SkillInvoker,
    /**
     * Marks the turn boundary for checkpoints: every workspace change the run
     * makes is attributed to this turn, so a later rewind can reach past the
     * single-entry undo. Absent means checkpoints simply are not recorded.
     */
    private readonly checkpoints?: CheckpointTurnStarter
  ) {}

  async send(
    text: string,
    onDelta: AgentDeltaListener,
    signal: AbortSignal,
    contexts: ExplicitFileContext[] = [],
    onToolEvent?: (event: AgentToolEvent) => void
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
      // The checkpoint boundary is the request the run is about to answer: every
      // workspace change from here on belongs to this turn.
      this.checkpoints?.startTurn(active.id, text, Math.max(0, active.items.length - 1));
      // `/name` loads a workspace skill for this turn only. It is resolved before
      // the identity check, because a skill invocation is work, never a question
      // about who the model is.
      const invokedSkill = await this.loadInvokedSkill(text, signal);
      // Identity questions go to the bare chat endpoint with no tools and no
      // history — byte-for-byte the raw API call — because agent-tuned models
      // otherwise role-play a different persona inside the tool loop. Normal
      // messages are never routed this way.
      const identityBypass = normalizedContexts.length === 0
        && !invokedSkill
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
        // Long-session guard (v0.7 DoD): when the provider declares a context
        // window, drop the oldest history turns that exceed it so a long
        // conversation never overflows and fails the request.
        // Long-session guard (v0.7 DoD): when the model's context window is known,
        // drop the oldest history turns that exceed it so a long conversation never
        // overflows and fails the request. The provider's own declaration wins; the
        // fallback comes from the same estimate the context gauge shows, so what the
        // user sees and what triggers compaction cannot drift apart.
        const declaredWindow = capabilities.maxContextTokens;
        const windowTokens = declaredWindow !== undefined && declaredWindow > 0
          ? declaredWindow
          : this.estimateContextWindow(selected.providerId, selected.modelId);
        if (windowTokens && windowTokens > 0 && messages.length > 1) {
          const last = messages[messages.length - 1];
          const currentTokens = estimateTokens(typeof last.content === 'string' ? last.content : '');
          // Cost/context control (v0.7): only a fraction of the window is used
          // for history, leaving room for the reply and future turns.
          const historyBudget = Math.floor(windowTokens * this.historyBudgetRatio) - CONTEXT_OVERHEAD_TOKENS - currentTokens;
          if (historyBudget > 0) {
            const history: CompactableMessage[] = messages.slice(0, -1).map(message => ({
              role: message.role,
              text: typeof message.content === 'string' ? message.content : ''
            }));
            const compacted = compactHistory(history, historyBudget);
            if (compacted.note) {
              messages = [
                { role: 'system' as const, content: compacted.note },
                ...compacted.messages.map(compactable => textMessage(compactable)),
                last
              ];
            }
          }
        }
        // Injected after compaction, so the skill the user explicitly asked for
        // cannot be treated as droppable history. It is a message for this turn
        // only: the stored user message stays exactly what was typed, so a long
        // skill costs context once instead of on every following turn.
        if (invokedSkill) messages = withSkillContext(messages, invokedSkill);
        if (capabilities.toolCalling) {
          const runner = await this.resolveAgentRunner(active);
          if (!runner) {
            throw new Error('Agent tools are unavailable for the current workspace. Use one local workspace folder or disable tool calling for this provider.');
          }
          response = await runner.run(
            provider,
            { model: selected.modelId, messages, ...sampling },
            { sessionId: active.id, mode: active.permissionMode },
            onDelta,
            signal,
            onToolEvent
          );
        } else {
          response = await streamChatText(provider, selected.modelId, messages, sampling, onDelta, signal);
        }
      }
      if (!response) throw new Error('Provider returned an empty response.');
      await this.sessions.appendAssistantMessage(response, 'provider');
      await this.sessions.setStatus('idle');
      // Only after the session is idle and the reply is persisted, so a titling
      // problem can never affect the run the user asked for.
      await this.applyAutoTitle(provider, selected.modelId, active.id, signal);
    } catch (error: unknown) {
      const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
      await this.sessions.setStatus(aborted ? 'interrupted' : 'blocked').catch(() => undefined);
      throw error;
    } finally {
      this.running = false;
      // Changes made outside a run are not attributed to the turn that just ended.
      this.checkpoints?.endTurn();
    }
  }

  /**
   * Names a session from its first exchange, so the history list reads as tasks
   * instead of a column of "New Chat". Best-effort by design: a provider failure,
   * an abort, or a model that answers with prose leaves the placeholder in place
   * and never turns a run that succeeded into a failed one.
   *
   * The request is bare — a system instruction plus the first exchange, no tools
   * and no replayed history — and its stream is discarded rather than shown.
   */
  private async loadInvokedSkill(
    text: string,
    signal: AbortSignal
  ): Promise<{ name: string; body: string } | undefined> {
    if (!this.skills) return undefined;
    const invocation = parseSkillInvocation(text);
    if (!invocation) return undefined;
    try {
      const skill = await this.skills.load(invocation.name, signal);
      return skill ? { name: skill.name, body: skill.body } : undefined;
    } catch (error) {
      signal.throwIfAborted();
      // A skill that cannot be read must not fail the message the user sent; it
      // is sent as typed instead.
      return undefined;
    }
  }

  /**
   * The model's context window when the provider does not declare one. A failure
   * here must not cost the message the user sent: an unknown window means "do not
   * compact", which is safe, whereas throwing would lose the turn.
   */
  private estimateContextWindow(providerId: string, modelId: string): number | undefined {
    try {
      const window = this.options.contextWindow?.(providerId, modelId);
      return window !== undefined && window > 0 ? window : undefined;
    } catch {
      return undefined;
    }
  }

  private async applyAutoTitle(
    provider: LLMProvider,
    model: string,
    sessionId: string,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.options.autoTitle?.().enabled) return;
    try {
      const session = this.sessions.getActiveSession();
      // The user can only switch sessions while idle, but check anyway rather
      // than naming a session that is no longer the one being talked about.
      if (session.id !== sessionId) return;
      if (!shouldGenerateSessionTitle(session)) return;
      // Deliberately no maxTokens cap. DeepSeek's current models default to
      // thinking mode, the reasoning arrives as `reasoning_content` rather than
      // `content`, and the provider treats a stream with no content at all as an
      // empty response. A small cap is therefore spent on reasoning and leaves
      // no title behind — which is exactly how sessions silently stayed at
      // "New Chat". The system instruction is what keeps the answer short.
      const raw = await streamChatText(
        provider,
        model,
        buildSessionTitleMessages(session.items),
        { temperature: 0 },
        () => undefined,
        signal
      );
      const title = parseSessionTitle(raw);
      if (!title) {
        console.warn(
          `[Yisi AI] Session auto-title produced no usable title (reply was ${raw.length} character(s)).`
        );
        return;
      }
      await this.sessions.setAiTitle(sessionId, title);
    } catch (error) {
      // Best effort — the placeholder stays — but never silently: an empty
      // stream or a rejected request has to be diagnosable from the log.
      console.warn(`[Yisi AI] Session auto-title failed: ${describeAutoTitleError(error)}`);
    }
  }

  /**
   * A write session may be isolated onto its own worktree (v0.4 DoD). When a
   * session-scoped runner is provided it takes precedence; otherwise fall back
   * to the shared agent runner.
   */
  private async resolveAgentRunner(active: { id: string; permissionMode: PermissionMode }): Promise<AgentConversationRunner | undefined> {
    if (this.sessionRunner) {
      const scoped = await this.sessionRunner({ sessionId: active.id, mode: active.permissionMode });
      if (scoped) return scoped;
    }
    return this.agentRunner;
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

/** Rebuild an agent message from compacted history text (user/assistant only). */
function textMessage(message: CompactableMessage): AgentConversationMessage {
  if (message.role === 'assistant') return { role: 'assistant', content: message.text };
  return { role: 'user', content: message.text };
}

function withExplicitContext(text: string, attachments: AttachmentContext[], budgetTokens: number): MessageContent {  if (attachments.length === 0) return text;

  const textual = attachments.filter(attachment => attachment.chunks.length > 0);
  const imageParts: Array<{ payload: AttachmentImagePayload; contextName: string }> = [];
  for (const attachment of attachments) {
    for (const image of attachmentImages(attachment)) {
      imageParts.push({ payload: image, contextName: attachment.fileName });
    }
  }
  const block = assembleAttachmentContexts(textual, budgetTokens);
  const textContent = block ? `${text}\n\nAttached context:\n${block}` : text;
  if (imageParts.length === 0) return textContent;

  const parts: Exclude<MessageContent, string> = [{ type: 'text', text: textContent }];
  for (const image of imageParts) {
    const displayName = image.payload.fileName ?? image.contextName;
    parts.push({ type: 'text', text: `[Attached image: ${displayName}]` });
    parts.push({
      type: 'image',
      mimeType: image.payload.mimeType,
      dataBase64: image.payload.dataBase64,
      fileName: displayName
    });
  }
  return parts;
}

function attachmentImages(attachment: AttachmentContext): AttachmentImagePayload[] {
  if (attachment.images && attachment.images.length > 0) return attachment.images;
  return attachment.image ? [attachment.image] : [];
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
      let content: MessageContent = item.text;
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

const autoTitleRedactor = createSecretRedactor();

/** A titling failure is only ever logged, so redact it before it reaches the log. */
function describeAutoTitleError(error: unknown): string {
  if (error instanceof Error) {
    const message = autoTitleRedactor.censor((error.message || '').slice(0, 200));
    return message ? `${error.name}: ${message}` : error.name || 'Error';
  }
  return 'unknown error';
}
