import * as vscode from 'vscode';
import {
  ToolConfirmationPort,
  ToolConfirmationRequest
} from '../../application/agent/readOnlyAgentLoop';
import { summarizeToolConfirmation } from './toolConfirmationSummary';

const APPROVE = 'Approve';

export class VsCodeToolConfirmation implements ToolConfirmationPort {
  async confirm(request: ToolConfirmationRequest, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    // Every permission-gated tool produces an actionable summary; the dialog
    // must never silently decline a request because the copy layer does not
    // recognize a tool id.
    const summary = summarizeToolConfirmation(request);
    const selection = await vscode.window.showWarningMessage(
      summary.message,
      { modal: true, detail: summary.detail },
      APPROVE
    );
    signal.throwIfAborted();
    return selection === APPROVE;
  }
}
