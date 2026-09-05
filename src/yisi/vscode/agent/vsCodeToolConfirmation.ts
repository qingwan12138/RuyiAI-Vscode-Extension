import { randomUUID } from 'node:crypto';
import {
  ToolConfirmationPort,
  ToolConfirmationRequest
} from '../../application/agent/readOnlyAgentLoop';
import { ApprovalBroker } from '../../application/agent/approvalBroker';
import { summarizeToolConfirmation } from './toolConfirmationSummary';

/**
 * Routes privileged tool approvals into the Yisi AI chat panel instead of a
 * window-modal dialog. Every permission-gated tool produces an actionable
 * summary; the request is posted to the sidebar, the user clicks Approve /
 * 拒绝, and the result resolves the agent loop's confirmation.
 */
export class VsCodeToolConfirmation implements ToolConfirmationPort {
  constructor(
    private readonly approvals: ApprovalBroker,
    private readonly createId: () => string = randomUUID
  ) {}

  async confirm(request: ToolConfirmationRequest, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const summary = summarizeToolConfirmation(request);
    const requestId = this.createId();
    return this.approvals.request(requestId, summary.message, summary.detail, signal, summary.diff);
  }
}
