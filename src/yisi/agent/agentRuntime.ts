export type AgentRunState = 'idle' | 'running' | 'interrupted' | 'blocked' | 'completed';

export class AgentRuntime {
  private controller?: AbortController;
  private state: AgentRunState = 'idle';

  getState(): AgentRunState { return this.state; }

  start(): AbortSignal {
    this.controller = new AbortController();
    this.state = 'running';
    return this.controller.signal;
  }

  stop(): void {
    this.controller?.abort();
    this.state = 'interrupted';
  }

  complete(): void {
    this.state = 'completed';
  }
}
