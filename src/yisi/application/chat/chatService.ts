import { SessionService } from '../session/sessionService';
import { ProviderCatalog } from '../provider/providerCatalog';
import { ChatMessage } from '../../llm/types';

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
    private readonly providers: Pick<ProviderCatalog, 'resolve'>
  ) {}

  async send(text: string, onDelta: (text: string) => void, signal: AbortSignal): Promise<void> {
    if (this.running) throw new ChatRunInProgressError();
    this.running = true;
    try {
      const selected = this.sessions.getActiveSession().model;
      if (!selected.providerId || !selected.modelId) throw new Error('Select a configured model before sending a message.');
      const provider = await this.providers.resolve(selected.providerId);
      await this.sessions.setStatus('running');
      await this.sessions.appendUserMessage(text);
      const active = this.sessions.getActiveSession();
      const messages: ChatMessage[] = [];
      for (const item of active.items) {
        if (item.type === 'userMessage') {
          messages.push({ role: 'user', content: item.text });
        } else if (item.source === 'provider') {
          messages.push({ role: 'assistant', content: item.text });
        }
      }

      let response = '';
      for await (const delta of provider.streamChat({ model: selected.modelId, messages }, signal)) {
        signal.throwIfAborted();
        response += delta.text;
        onDelta(delta.text);
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
