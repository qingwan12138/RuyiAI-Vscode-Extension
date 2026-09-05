import * as vscode from 'vscode';
import {
  ToolConfirmationPort,
  ToolConfirmationRequest
} from '../../application/agent/readOnlyAgentLoop';
import { summarizeToolConfirmation } from './toolConfirmationSummary';

const APPLY = 'Apply edit';

export class VsCodeToolConfirmation implements ToolConfirmationPort {
  async confirm(request: ToolConfirmationRequest, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const summary = summarizeToolConfirmation(request);
    if (!summary) return false;
    const selection = await vscode.window.showWarningMessage(
      summary.message,
      { modal: true, detail: summary.detail },
      APPLY
    );
    signal.throwIfAborted();
    return selection === APPLY;
  }
}
