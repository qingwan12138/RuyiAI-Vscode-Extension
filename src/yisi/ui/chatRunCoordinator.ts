import { ChatService } from '../application/chat/chatService';

export type ChatRunEvent =
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'sessionError'; message: string };

export class ChatRunCoordinator {
  private controller?: AbortController;

  constructor(
    private readonly chat: Pick<ChatService, 'send'>,
    private readonly emit: (event: ChatRunEvent) => void
  ) {}

  isRunning(): boolean {
    return this.controller !== undefined;
  }

  async start(text: string): Promise<void> {
    if (this.controller) {
      this.emit({ type: 'sessionError', message: 'A chat run is already in progress.' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.emit({ type: 'assistantStreamStarted' });
    try {
      await this.chat.send(
        text,
        delta => this.emit({ type: 'assistantStreamDelta', text: delta }),
        controller.signal
      );
      this.emit({ type: 'assistantStreamCompleted' });
    } catch (error: unknown) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        this.emit({ type: 'runStopped' });
      } else {
        this.emit({ type: 'sessionError', message: safeMessage(error) });
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  stop(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : 'The provider request failed.';
}
