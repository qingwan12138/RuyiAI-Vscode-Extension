/**
 * Bridges Webview-side tool approvals with the Agent loop. The loop (running in
 * the extension host) requests approval for a privileged tool action; the
 * request is posted to the Yisi AI Webview sidebar where the user clicks
 * Approve / 拒绝, and the response resolves the pending promise. Keeps the
 * approval prompt inside the chat panel instead of a window-modal dialog.
 *
 * This lives in the application layer: it holds only a post callback port, so
 * neither this module nor the agent loop depends on vscode or the webview.
 */
export interface ToolApprovalRequestMessage {
  type: 'toolApprovalRequest';
  requestId: string;
  message: string;
  detail: string;
}

export class ApprovalBroker {
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private post: (message: ToolApprovalRequestMessage) => void = () => undefined;
  private attached = false;

  /** Attach the webview poster. Call once the view resolves. */
  attachPost(post: (message: ToolApprovalRequestMessage) => void): void {
    this.post = post;
    this.attached = true;
  }

  detachPost(): void {
    this.post = () => undefined;
    this.attached = false;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Ask the user to approve a tool action. Resolves false immediately when no
   * view is attached or the run is already aborted.
   */
  request(
    requestId: string,
    message: string,
    detail: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.attached) {
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      let settled = false;
      const settle = (approved: boolean) => {
        if (settled) return;
        settled = true;
        this.pending.delete(requestId);
        resolve(approved);
      };
      this.pending.set(requestId, settle);
      this.post({ type: 'toolApprovalRequest', requestId, message, detail });
      if (signal) {
        if (signal.aborted) settle(false);
        else signal.addEventListener('abort', () => settle(false), { once: true });
      }
    });
  }

  /** Resolve a specific request from the webview response message. */
  resolve(requestId: string, approved: boolean): void {
    const pending = this.pending.get(requestId);
    if (pending) pending(approved);
  }

  /** Fail every pending approval (e.g. the view disposed during a run). */
  cancelAll(): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of pending) resolve(false);
  }
}
