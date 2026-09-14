/**
 * Builds the whole-file, side-by-side view of a pending edit.
 *
 * Why this exists: the approval card can only show the *fragment* being replaced
 * (`-old / +new`), which is fine for a one-line change and useless for judging a
 * change in context. The reference design opens the proposal in the editor's own
 * diff view instead, so that is what this produces — the file as it is now on the
 * left, the file as it would become on the right.
 *
 * Two things this module is deliberately **not**:
 *
 *  - it is not an approval path. The inline approval card stays the only gate; the
 *    diff is a view of the same request, so there is never a second place that can
 *    approve an action (AGENTS.md §2).
 *  - it is not a source of truth for the edit. The tool still applies
 *    `oldText`/`newText` under the SHA-256 stale guard; this only renders what
 *    that would produce. If the buffer no longer matches, the view is skipped
 *    rather than showing a change that would not actually happen.
 *
 * Free of `vscode` imports so the content rules can be unit-tested; the editor
 * plumbing lives in vscode/agent/proposalDiff.
 */

export interface ProposalRequest {
  toolId: string;
  input: Record<string, unknown>;
}

export interface ProposalView {
  /** Tab title for the diff editor. */
  title: string;
  /** Left side: the file as it is now. */
  leftContent: string;
  /** Right side: the file as it would become if approved. */
  rightContent: string;
  /** Workspace-relative path, when the request names one. */
  path?: string;
}

export type ProposalViewResult = { view: ProposalView } | { skipped: string };

/** Above this, a diff is more likely to hang the editor than help the user. */
export const MAX_PROPOSAL_DIFF_BYTES = 512 * 1024;

export function buildProposalView(
  request: ProposalRequest,
  currentText: string | undefined
): ProposalViewResult {
  const path = typeof request.input.path === 'string' ? request.input.path : undefined;

  if (request.toolId === 'create_text_file') {
    const content = request.input.content;
    if (typeof path !== 'string' || typeof content !== 'string') return skip('the request is incomplete');
    // A new file: the left side is intentionally empty.
    return sized({ title: `Yisi AI: ${path} (new file)`, leftContent: '', rightContent: content, path });
  }

  if (request.toolId === 'rewrite_text_file') {
    const content = request.input.content;
    if (typeof path !== 'string' || typeof content !== 'string') return skip('the request is incomplete');
    if (currentText === undefined) return skip('the current file could not be read');
    return sized({ title: `Yisi AI: ${path} (whole file)`, leftContent: currentText, rightContent: content, path });
  }

  if (request.toolId === 'replace_text') {
    const { oldText, newText } = request.input;
    if (typeof path !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
      return skip('the request is incomplete');
    }
    if (currentText === undefined) return skip('the current file could not be read');
    const at = currentText.indexOf(oldText);
    if (at < 0 || currentText.indexOf(oldText, at + 1) >= 0) {
      // Rendering a "would become" that the edit tool would refuse (it requires a
      // unique match) would be a lie about what approval does.
      return skip('the file no longer matches the proposed edit exactly once');
    }
    const rightContent = currentText.slice(0, at) + newText + currentText.slice(at + oldText.length);
    return sized({ title: `Yisi AI: ${path} (edit)`, leftContent: currentText, rightContent, path });
  }

  if (request.toolId === 'delete_file') {
    if (typeof path !== 'string') return skip('the request is incomplete');
    if (currentText === undefined) return skip('the current file could not be read');
    return sized({ title: `Yisi AI: ${path} (delete)`, leftContent: currentText, rightContent: '', path });
  }

  // Everything else (commands, renames, Ruyi operations, MCP tools) has no text to
  // compare; the approval card's own summary remains the whole story.
  return skip('this action has no text diff');
}

function sized(view: ProposalView): ProposalViewResult {
  if (bytes(view.leftContent) > MAX_PROPOSAL_DIFF_BYTES || bytes(view.rightContent) > MAX_PROPOSAL_DIFF_BYTES) {
    return skip(`the file is larger than ${Math.round(MAX_PROPOSAL_DIFF_BYTES / 1024)} KB`);
  }
  return { view };
}

function skip(reason: string): ProposalViewResult {
  return { skipped: reason };
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
