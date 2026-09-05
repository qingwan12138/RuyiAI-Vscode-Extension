import { ChatService, ExplicitFileContext } from '../application/chat/chatService';

export type ChatRunEvent =
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'sessionError'; message: string };

/**
 * Terminal result of a coordinator run. The coordinator keeps emitting live
 * lifecycle events (started/delta/completed/runStopped) but does NOT emit
 * `sessionError` itself: the caller surfaces run errors AFTER it re-publishes
 * session state, otherwise the webview's state re-render wipes the error from
 * the UI before the user ever sees it.
 */
export type ChatRunOutcome =
  | { status: 'completed' }
  | { status: 'stopped' }
  | { status: 'error'; message: string };

export class ChatRunCoordinator {
  private controller?: AbortController;

  constructor(
    private readonly chat: Pick<ChatService, 'send'>,
    private readonly emit: (event: ChatRunEvent) => void
  ) {}

  isRunning(): boolean {
    return this.controller !== undefined;
  }

  async start(text: string, contexts: ExplicitFileContext[] = []): Promise<ChatRunOutcome> {
    if (this.controller) {
      return { status: 'error', message: 'A chat run is already in progress.' };
    }
    const controller = new AbortController();
    this.controller = controller;
    this.emit({ type: 'assistantStreamStarted' });
    try {
      await this.chat.send(
        text,
        delta => this.emit({ type: 'assistantStreamDelta', text: delta }),
        controller.signal,
        contexts
      );
      this.emit({ type: 'assistantStreamCompleted' });
      return { status: 'completed' };
    } catch (error: unknown) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        this.emit({ type: 'runStopped' });
        return { status: 'stopped' };
      }
      return { status: 'error', message: safeMessage(error) };
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
