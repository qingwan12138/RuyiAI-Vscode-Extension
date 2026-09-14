import { randomUUID } from 'node:crypto';
import {
  ToolConfirmationDecision,
  ToolConfirmationPort,
  ToolConfirmationRequest
} from '../../application/agent/readOnlyAgentLoop';
import { ApprovalBroker } from '../../application/agent/approvalBroker';
import { summarizeToolConfirmation } from './toolConfirmationSummary';
import { PlanDocumentPresenter } from './planDocument';

/**
 * Routes privileged tool approvals into the Yisi AI chat panel instead of a
 * window-modal dialog. Every permission-gated tool produces an actionable
 * summary; the request is posted to the sidebar, the user clicks Approve /
 * 拒绝, and the result resolves the agent loop's confirmation.
 *
 * Two review surfaces can be opened alongside the card:
 *  - a text edit opens in the editor's diff view (`proposals`), so it can be
 *    judged in context;
 *  - Plan mode's reviewed exit opens the plan as an editable markdown document
 *    (`planDocuments`), and what the user changes there is returned as feedback.
 *
 * Both are **views of the same request**, never a second approval path: the
 * sidebar card is still the only thing that decides, and they are opened before
 * the decision is awaited so the user can look while deciding.
 */
export class VsCodeToolConfirmation implements ToolConfirmationPort {
  constructor(
    private readonly approvals: ApprovalBroker,
    private readonly createId: () => string = randomUUID,
    private readonly proposals?: { open(request: ToolConfirmationRequest): Promise<void> },
    private readonly planDocuments?: PlanDocumentPresenter
  ) {}

  async confirm(
    request: ToolConfirmationRequest,
    signal: AbortSignal
  ): Promise<boolean | ToolConfirmationDecision> {
    signal.throwIfAborted();
    const summary = summarizeToolConfirmation(request);
    const requestId = this.createId();
    // Fire-and-forget: opening a review document must never delay or fail an
    // approval.
    void this.proposals?.open(request);
    const handle = request.planDocument
      ? await this.planDocuments?.open(request.planDocument, summary.message)
      : undefined;
    const approved = await this.approvals.request(requestId, summary.message, summary.detail, signal, summary.diff);
    const feedback = this.planDocuments?.feedback(handle);
    return feedback ? { approved, feedback } : approved;
  }
}
