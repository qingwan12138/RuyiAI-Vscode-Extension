import * as vscode from 'vscode';
import { extractPlanFeedback } from '../../application/agent/planReview';

/**
 * Opens the plan for review as an editable markdown document.
 *
 * The document is **not** an approval channel: deciding still happens in the
 * sidebar card (same invariant as the proposal diff). What the document adds is
 * room to read a multi-step plan and to answer it in place — anything the user
 * changes before deciding is extracted as feedback and handed back to the model.
 *
 * An untitled document is used deliberately: it is genuinely editable, it never
 * touches disk, and closing it without saving simply means "no comments". The
 * handle keeps the live document, so feedback is read from the buffer rather than
 * from a file that was never written.
 */

export interface PlanDocumentHandle {
  /** The document as it was written by the agent. */
  original: string;
  document: vscode.TextDocument;
}

export class PlanDocumentPresenter {
  /** Opens the document beside the sidebar. Never throws: review is optional. */
  async open(content: string, title: string): Promise<PlanDocumentHandle | undefined> {
    try {
      const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
      await vscode.window.showTextDocument(document, { preview: false });
      void title;
      return { original: content, document };
    } catch {
      // A failure to open a review document must not block the approval itself;
      // the card still carries the justification.
      return undefined;
    }
  }

  /** Comments the user left, or undefined when the document is unchanged or gone. */
  feedback(handle: PlanDocumentHandle | undefined): string | undefined {
    if (!handle) return undefined;
    try {
      if (handle.document.isClosed) return undefined;
      return extractPlanFeedback(handle.original, handle.document.getText());
    } catch {
      return undefined;
    }
  }
}
