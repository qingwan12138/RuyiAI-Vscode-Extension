import { PermissionMode } from '../../domain/session';
import { renderTextDiff } from '../edit/editJournal';

/**
 * Plan review: the document a Plan-mode run hands to the user, and the feedback
 * they leave inside it before deciding.
 *
 * Why this exists: Plan mode already has a reviewed exit — `request_permission`
 * asks to apply a finished plan, grounded in a refusal that actually happened —
 * but the plan itself arrived as one line inside a generic approval card, which is
 * not enough to judge a multi-step change. The reference design opens the plan as
 * a document and lets the user comment inline before approving; this module
 * produces that document and extracts exactly what the user changed.
 *
 * Two deliberate boundaries:
 *
 *  - **The document is not an approval channel.** Deciding still happens in the
 *    sidebar card (AGENTS.md §2 and the same invariant as the proposal diff); a
 *    document left open decides nothing.
 *  - **Feedback is a diff, not the whole document.** Sending the plan back verbatim
 *    would spend the context budget twice for no gain, and would make it hard for
 *    the model to see what was actually asked of it.
 */

const MAX_PLAN_CHARACTERS = 8_000;
const MAX_FEEDBACK_CHARACTERS = 2_000;

export interface PlanReviewInput {
  plan: string;
  mode: PermissionMode;
  justification: string;
}

/** Trims a plan body and bounds it; empty input means "there is no plan". */
export function normalizePlan(plan: unknown): string | undefined {
  if (typeof plan !== 'string') return undefined;
  const text = plan.replace(/\r\n/g, '\n').trim();
  if (!text) return undefined;
  return text.length <= MAX_PLAN_CHARACTERS ? text : `${text.slice(0, MAX_PLAN_CHARACTERS - 1)}…`;
}

/**
 * The markdown document shown for review. The header explains what to do; the
 * plan itself is delimited so it stays readable as a plain document.
 */
export function buildPlanDocument(input: PlanReviewInput): string {
  return [
    '# Plan for review',
    '',
    '> Decide in the **Yisi AI sidebar** (Approve / 拒绝) — this document decides nothing on its own.',
    '> **Comment inline**: edit or add lines here before deciding, and exactly what you changed',
    '> is sent back to the agent as feedback.',
    '',
    `**Requested mode:** ${MODE_LABELS[input.mode]}`,
    `**Why:** ${input.justification}`,
    '',
    '---',
    '',
    input.plan
  ].join('\n');
}

/**
 * What the user changed in the document, as a compact `-`/`+` block. Returns
 * undefined when they changed nothing, because "no feedback" and "empty feedback"
 * must not look the same to the model.
 */
export function extractPlanFeedback(original: string, edited: string): string | undefined {
  if (typeof edited !== 'string') return undefined;
  const before = original.replace(/\r\n/g, '\n');
  const after = edited.replace(/\r\n/g, '\n');
  if (before === after || !after.trim()) return undefined;
  const diff = renderTextDiff(before, after, 'plan comments');
  const lines = diff
    .split('\n')
    .filter(line => line.startsWith('-') || line.startsWith('+'))
    // Drop the diff's own file header, which is noise for the model.
    .filter(line => !line.startsWith('---') && !line.startsWith('+++'));
  if (!lines.length) return undefined;
  const text = lines.join('\n');
  return text.length <= MAX_FEEDBACK_CHARACTERS
    ? text
    : `${text.slice(0, MAX_FEEDBACK_CHARACTERS - 1)}…`;
}

const MODE_LABELS: Record<PermissionMode, string> = {
  plan: 'Plan',
  manual: 'Manual',
  acceptEdits: 'Accept Edits',
  auto: 'Auto',
  fullAccess: 'Full Access'
};
