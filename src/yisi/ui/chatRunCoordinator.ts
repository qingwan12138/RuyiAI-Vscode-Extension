import { ChatService, ExplicitFileContext } from '../application/chat/chatService';
import { AgentToolEvent } from '../application/agent/readOnlyAgentLoop';

export type ChatRunEvent =
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'sessionError'; message: string }
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
  return error instanceof Error ? error.message.slice(0, 240) : 'The provider request failed.';
}
