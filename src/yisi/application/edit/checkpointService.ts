import { SessionService } from '../session/sessionService';
import { WorkspaceEditService } from './workspaceEditService';
import { CheckpointStore, CheckpointSummary } from './checkpointStore';

/**
 * Checkpoint operations: rewind the code, fork the conversation, or both.
 *
 * The two halves are independent on purpose (the reference design offers them as
 * separate choices, and so does this):
 *  - **rewind** replays the inverse of every recorded change after the checkpoint,
 *    newest first, each one guarded by the stale check — so a file the user edited
 *    since is refused rather than clobbered;
 *  - **fork** branches the conversation at the checkpoint and leaves the code
 *    exactly as it is.
 *
 * A rewind is announced honestly: `failed` carries a reason per file, and the
 * checkpoint is only forgotten when **every** change was reverted. A partial
 * rewind keeps the record, because the user may still want to retry and because a
 * record that silently disagrees with the workspace is worse than none.
 */

export interface RewindOutcome {
  /** Files whose change was successfully inverted. */
  restored: string[];
  /** Files that could not be reverted, with the reason. */
  failed: { path: string; reason: string }[];
  /** True when there was something to do and all of it succeeded. */
  complete: boolean;
}

export interface ForkOutcome {
  sessionId: string;
  title: string;
  itemCount: number;
}

export class CheckpointService {
  constructor(
    private readonly store: CheckpointStore,
    private readonly edits: Pick<WorkspaceEditService, 'restoreFromCheckpoint'>,
    private readonly sessions: Pick<SessionService, 'forkSession'>
  ) {}

  list(sessionId: string): CheckpointSummary[] {
    return this.store.turns(sessionId);
  }

  async rewind(sessionId: string, turnId: string, signal: AbortSignal): Promise<RewindOutcome> {
    const plan = this.store.rewindPlan(sessionId, turnId);
    const restored: string[] = [];
    const failed: { path: string; reason: string }[] = [];
    for (const change of plan) {
      const result = await this.edits.restoreFromCheckpoint(change, signal);
      if (result.restored) restored.push(result.path);
      else failed.push({ path: result.path, reason: result.reason ?? 'Unknown rewind failure.' });
    }
    if (plan.length > 0 && failed.length === 0) this.store.dropAfter(sessionId, turnId);
    return { restored, failed, complete: plan.length > 0 && failed.length === 0 };
  }

  /**
   * Branches the conversation so it continues **before** the chosen turn: the
   * forked session keeps the history up to (not including) that turn's request, so
   * the user can ask again differently. The code is untouched.
   */
  async fork(sessionId: string, turnId: string): Promise<ForkOutcome | undefined> {
    const turns = this.store.turns(sessionId);
    const target = turns.find(turn => turn.id === turnId);
    if (!target) return undefined;
    const itemIndex = this.store.forkPoint(sessionId, turnId);
    if (itemIndex === undefined) return undefined;
    const forked = await this.sessions.forkSession(itemIndex, forkTitle(target.label));
    return { sessionId: forked.id, title: forked.title, itemCount: forked.items.length };
  }
}

/** Names the branch after the turn it came from, bounded for the session list. */
export function forkTitle(label: string): string {
  const clean = label.trim().replace(/\s+/g, ' ');
  const base = clean || 'Checkpoint';
  return (base.length > 60 ? `${base.slice(0, 59)}…` : base) + ' (fork)';
}
