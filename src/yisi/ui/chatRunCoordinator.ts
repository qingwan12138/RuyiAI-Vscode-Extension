import { ChatService, ExplicitFileContext } from '../application/chat/chatService';
import { AgentToolEvent } from '../application/agent/readOnlyAgentLoop';
import { createSecretRedactor } from '../application/security/secretRedactor';

const redactor = createSecretRedactor();

export type ChatRunEvent =
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'sessionError'; message: string }
  | { type: 'stallNotice'; message: string }
  | { type: 'agentToolCall'; id: string; name: string; input: unknown }
  | { type: 'agentToolResult'; id: string; name: string; outcome: 'succeeded' | 'failed'; summary: string };

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

export interface ChatRunCoordinatorOptions {
  /** No delta for this long -> emit a notice (never abort) telling the user
   * they can wait or stop. Default 90s. */
  stallNoticeMs?: number;
  /** How often the watchdog checks. Default 4s. */
  watchdogIntervalMs?: number;
}

const DEFAULT_STALL_NOTICE_MS = 90_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 4_000;
const STALL_NOTICE_MESSAGE = '长时间未收到模型响应（90s）。可能是 Provider 连接/模型/网络问题；可以继续等待，或点 Stop 中止本次运行。';

export class ChatRunCoordinator {
  private controller?: AbortController;
  private readonly stallNoticeMs: number;
  private readonly watchdogIntervalMs: number;

  constructor(
    private readonly chat: Pick<ChatService, 'send'>,
    private readonly emit: (event: ChatRunEvent) => void,
    options: ChatRunCoordinatorOptions = {}
  ) {
    this.stallNoticeMs = options.stallNoticeMs ?? DEFAULT_STALL_NOTICE_MS;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
  }

  isRunning(): boolean {
    return this.controller !== undefined;
  }

  async start(text: string, contexts: ExplicitFileContext[] = []): Promise<ChatRunOutcome> {
    if (this.controller) {
      return { status: 'error', message: 'A chat run is already in progress.' };
    }
    const controller = new AbortController();
    this.controller = controller;
    let lastActivity = Date.now();
    let stallNotified = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity >= this.stallNoticeMs && !stallNotified) {
        stallNotified = true;
        this.emit({ type: 'stallNotice', message: STALL_NOTICE_MESSAGE });
      }
    }, this.watchdogIntervalMs);

    this.emit({ type: 'assistantStreamStarted' });
    try {
      await this.chat.send(
        text,
        delta => {
          lastActivity = Date.now();
          stallNotified = false;
          this.emit({ type: 'assistantStreamDelta', text: delta });
        },
        controller.signal,
        contexts,
        event => this.emitToolEvent(event)
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
      clearInterval(watchdog);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  stop(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }

  /** Mirror an agent tool lifecycle event to the webview as its own message. */
  private emitToolEvent(event: AgentToolEvent): void {
    if (event.type === 'toolCall') {
      this.emit({ type: 'agentToolCall', id: event.id, name: event.name, input: event.input });
    } else {
      this.emit({ type: 'agentToolResult', id: event.id, name: event.name, outcome: event.outcome, summary: event.summary });
    }
  }
}

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.slice(0, 240) : 'The provider request failed.';
  // Censor secret-shaped substrings before any error is surfaced to the user.
  return redactor.censor(raw);
}
