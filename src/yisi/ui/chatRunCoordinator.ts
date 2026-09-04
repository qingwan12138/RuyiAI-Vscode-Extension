import { ChatService, ExplicitFileContext } from '../application/chat/chatService';

export type ChatRunEvent =
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'sessionError'; message: string };

/** No deltas for this long -> treat the run as stalled and surface an error. */
const STALL_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 4_000;
const STALL_MESSAGE = '长时间未收到模型响应（60s）。请检查 Provider 连接、API Key、模型 ID 与网络，或点 Stop 中止本次运行。';

export class ChatRunCoordinator {
  private controller?: AbortController;

  constructor(
    private readonly chat: Pick<ChatService, 'send'>,
    private readonly emit: (event: ChatRunEvent) => void
  ) {}

  isRunning(): boolean {
    return this.controller !== undefined;
  }

  async start(text: string, contexts: ExplicitFileContext[] = []): Promise<void> {
    if (this.controller) {
      this.emit({ type: 'sessionError', message: 'A chat run is already in progress.' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    // Stall watchdog: if the provider never yields a delta, abort the run and
    // show a concrete error instead of hanging on "Thinking…" forever.
    let stalled = false;
    let lastActivity = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity >= STALL_TIMEOUT_MS) {
        stalled = true;
        controller.abort();
      }
    }, WATCHDOG_INTERVAL_MS);

    this.emit({ type: 'assistantStreamStarted' });
    try {
      await this.chat.send(
        text,
        delta => {
          lastActivity = Date.now();
          this.emit({ type: 'assistantStreamDelta', text: delta });
        },
        controller.signal,
        contexts
      );
      this.emit({ type: 'assistantStreamCompleted' });
    } catch (error: unknown) {
      if (stalled) {
        this.emit({ type: 'sessionError', message: STALL_MESSAGE });
      } else if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        this.emit({ type: 'runStopped' });
      } else {
        this.emit({ type: 'sessionError', message: safeMessage(error) });
      }
    } finally {
      clearInterval(watchdog);
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
