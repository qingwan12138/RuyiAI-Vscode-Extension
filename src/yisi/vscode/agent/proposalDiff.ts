import * as vscode from 'vscode';
import { ProposalRequest, buildProposalView } from '../../application/edit/proposalDiffContent';

/**
 * Opens a pending edit in VS Code's own diff editor, side by side.
 *
 * The diff is a **view**: the inline approval card in the sidebar stays the gate,
 * so there is exactly one place that can approve an action. Closing the diff does
 * not decide anything, and approving does not require the diff to be open.
 *
 * The proposed side is served from memory through a `TextDocumentContentProvider`
 * (scheme `yisi-proposal`), so nothing is written to disk before approval — the
 * same rule the edit tools follow. When the current file already matches the left
 * side, the *real* file is used for that side instead, so the diff keeps syntax
 * highlighting, folding and git decorations where it can.
 */

const SCHEME = 'yisi-proposal';
/** Total virtual content kept alive, so a long session cannot grow without bound. */
const MAX_RETAINED_BYTES = 8 * 1024 * 1024;

export class ProposalDiffPresenter implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, { text: string; bytes: number }>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly registration: vscode.Disposable;
  private retainedBytes = 0;
  private sequence = 0;

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, this);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString())?.text ?? '';
  }

  dispose(): void {
    this.registration.dispose();
    this.emitter.dispose();
    this.contents.clear();
  }

  /**
   * Opens the proposal, if it has a text diff worth showing. Never throws: a
   * missing or unreadable file must not break the approval it is presenting.
   */
  async open(request: ProposalRequest, root?: string): Promise<void> {
    try {
      const path = typeof request.input.path === 'string' ? request.input.path : undefined;
      const file = path && root ? vscode.Uri.joinPath(vscode.Uri.file(root), path) : undefined;
      const current = file ? await readIfAvailable(file) : undefined;
      const built = buildProposalView(request, current);
      if ('skipped' in built) return;
      const { title, leftContent, rightContent, path: relativePath } = built.view;

      // The real file is a better left side than a copy of it, whenever it still
      // has the content the view was built from.
      const left =
        file && leftContent === current
          ? file
          : this.publish(`${relativePath ?? 'proposal'}.before`, leftContent);
      const right = this.publish(`${relativePath ?? 'proposal'}.after`, rightContent);

      await vscode.commands.executeCommand('vscode.diff', left, right, title);
      if (relativePath) await this.matchLanguage(left, file);
    } catch {
      // The approval card still carries the fragment diff, so nothing is lost.
    }
  }

  private publish(name: string, text: string): vscode.Uri {
    this.sequence += 1;
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${name}`, query: String(this.sequence) });
    const bytes = Buffer.byteLength(text, 'utf8');
    this.contents.set(uri.toString(), { text, bytes });
    this.retainedBytes += bytes;
    this.evictWhileOverBudget();
    return uri;
  }

  private evictWhileOverBudget(): void {
    // Map iteration is insertion-ordered, so the oldest entry goes first. The
    // entries still referenced by an open diff would render empty afterwards,
    // which is why the budget is generous rather than tight.
    while (this.retainedBytes > MAX_RETAINED_BYTES && this.contents.size > 1) {
      const oldest = this.contents.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.retainedBytes -= this.contents.get(oldest)?.bytes ?? 0;
      this.contents.delete(oldest);
    }
  }

  /** Gives the virtual side the same language as the real file, when known. */
  private async matchLanguage(uri: vscode.Uri, file: vscode.Uri | undefined): Promise<void> {
    if (!file) return;
    try {
      const source = await vscode.workspace.openTextDocument(file);
      const target = await vscode.workspace.openTextDocument(uri);
      if (target.languageId !== source.languageId) {
        await vscode.languages.setTextDocumentLanguage(target, source.languageId);
      }
    } catch {
      // A language hint is a nicety; the diff is already open and readable.
    }
  }
}

async function readIfAvailable(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return undefined;
  }
}
