import { JournalMutationKind } from './editJournal';

/**
 * Checkpoints: revert the workspace to any earlier turn, not just the last edit.
 *
 * Clean-room note: the behaviour was studied from published documentation
 * (docs/04) — a checkpoint is taken per turn, and the user can rewind the *code*
 * to it, start a new conversation *from* it, or both. No implementation or UI was
 * copied, and Yisi's model is deliberately its own: the store records the inverse
 * of each change so a rewind is an ordinary guarded write, not a snapshot system.
 *
 * ## Why this is not "snapshots of the whole workspace"
 *
 * Only files the agent actually changed are recorded, and each record keeps the
 * previous and resulting text (bounded) rather than a copy of the tree. That
 * reuses the same budgeted-capture idea as the edit journal, and it means a
 * rewind is a list of concrete inverse operations that each pass through the
 * existing stale guard — so a rewind can never clobber an edit the user made
 * after the agent's.
 *
 * ## Bounds
 *
 * A checkpoint store that grows without limit is a leak, so it is bounded on
 * turns, changes per turn, and retained text. Anything that does not fit is
 * recorded as **not reversible, with a reason** — the honest answer, and the same
 * one the journal gives.
 */

export interface CheckpointChange {
  kind: JournalMutationKind;
  /** Path the change targeted (for a rename: the path *before* the rename). */
  path: string;
  /** Previous content; null means the file did not exist before the change. */
  beforeText: string | null;
  /** Resulting content; null means the change deleted the file. */
  afterText: string | null;
  beforeSha256?: string;
  afterSha256?: string;
  /** Rename target, i.e. the path after the change. */
  toPath?: string;
  /** False when the information needed to invert this change was not retained. */
  reversible: boolean;
  reason?: string;
}

export interface CheckpointTurn {
  id: string;
  sessionId: string;
  /** 1-based user-turn ordinal within the session. */
  index: number;
  /** Short label, normally the user message that opened the turn. */
  label: string;
  createdAt: number;
  /**
   * Session item index of the user message that opened this turn. Forking at this
   * checkpoint restores the conversation as it was just before that request.
   */
  itemIndex: number;
  changes: CheckpointChange[];
}

export interface CheckpointLimits {
  maxTurns: number;
  maxChangesPerTurn: number;
  /** Cap on the text retained per side of a change, in bytes. */
  maxTextBytes: number;
}

export const DEFAULT_CHECKPOINT_LIMITS: CheckpointLimits = {
  maxTurns: 12,
  maxChangesPerTurn: 40,
  maxTextBytes: 64 * 1024
};

/** What `WorkspaceEditService` calls after each successful mutation. */
export interface CheckpointRecorder {
  record(change: CheckpointChange): void;
}

export interface CheckpointSummary {
  id: string;
  index: number;
  label: string;
  createdAt: number;
  changes: number;
  /** Changes that carry a reason they cannot be inverted. */
  notReversible: number;
}

/**
 * The turn boundary the composer reports to the store. Kept to two calls so
 * `ChatService` needs no knowledge of checkpoints beyond "a turn starts here".
 */
export interface CheckpointTurnStarter {
  startTurn(sessionId: string, label: string, itemIndex: number): void;
  endTurn(): void;
}

export class CheckpointStore implements CheckpointRecorder, CheckpointTurnStarter {
  private readonly bySessions = new Map<string, CheckpointTurn[]>();
  private active?: { sessionId: string; turn: CheckpointTurn };

  constructor(
    private readonly limits: CheckpointLimits = DEFAULT_CHECKPOINT_LIMITS,
    private readonly now: () => number = () => Date.now(),
    private readonly createId: () => string = () => `cp-${Math.random().toString(36).slice(2, 10)}`
  ) {}

  /**
   * Opens a new turn for a session. Called once per user message, before the run,
   * so every change the run makes is attributed to that turn.
   */
  startTurn(sessionId: string, label: string, itemIndex = 0): void {
    const turns = this.turnsFor(sessionId);
    const previous = turns.at(-1);
    const turn: CheckpointTurn = {
      id: this.createId(),
      sessionId,
      index: (previous?.index ?? 0) + 1,
      label: label.trim().slice(0, 80) || `Turn ${(previous?.index ?? 0) + 1}`,
      createdAt: this.now(),
      itemIndex: Math.max(0, Math.trunc(itemIndex)),
      changes: []
    };
    turns.push(turn);
    this.active = { sessionId, turn };
    while (turns.length > this.limits.maxTurns) turns.shift();
  }

  /** Records one successful mutation into the open turn, if there is one. */
  record(change: CheckpointChange): void {
    const active = this.active;
    if (!active) return;
    // A turn that was trimmed away by the bound must not accumulate again.
    if (!this.turnsFor(active.sessionId).includes(active.turn)) return;
    if (active.turn.changes.length >= this.limits.maxChangesPerTurn) {
      const dropped = active.turn.changes.length;
      const last = active.turn.changes.at(-1);
      if (last && !last.reason?.startsWith('This turn hit its checkpoint bound')) {
        active.turn.changes[active.turn.changes.length - 1] = {
          ...last,
          reversible: false,
          reason: `This turn hit its checkpoint bound (${this.limits.maxChangesPerTurn} changes, ${dropped} recorded).`
        };
      }
      return;
    }
    active.turn.changes.push(bound(change, this.limits.maxTextBytes));
  }

  /** Turns recorded for a session, oldest first. */
  turns(sessionId: string): CheckpointSummary[] {
    return this.turnsFor(sessionId).map(turn => ({
      id: turn.id,
      index: turn.index,
      label: turn.label,
      createdAt: turn.createdAt,
      changes: turn.changes.length,
      notReversible: turn.changes.filter(change => !change.reversible).length
    }));
  }

  /**
   * The inverse operations that take the workspace back to the state **before**
   * `turnId` ran, newest change first. `turnId === undefined` means "before every
   * recorded change".
   *
   * The chosen turn is included: a checkpoint marks the start of a turn, so
   * rewinding to it means undoing that turn's own changes as well — otherwise
   * "go back to before I asked that" would leave half of the answer in place.
   */
  rewindPlan(sessionId: string, turnId: string | undefined): CheckpointChange[] {
    const turns = this.turnsFor(sessionId);
    if (!turns.length) return [];
    let targetIndex = 1;
    if (turnId !== undefined) {
      const target = turns.find(turn => turn.id === turnId);
      if (!target) return [];
      targetIndex = target.index;
    } else {
      targetIndex = turns[0].index;
    }
    return turns
      .filter(turn => turn.index >= targetIndex)
      .slice()
      .reverse()
      .flatMap(turn => [...turn.changes].reverse());
  }

  /** Forgets `turnId` and everything after it; used once a rewind has succeeded. */
  dropAfter(sessionId: string, turnId: string): void {
    const turns = this.turnsFor(sessionId);
    const target = turns.find(turn => turn.id === turnId);
    if (!target) return;
    const kept = turns.filter(turn => turn.index < target.index);
    this.bySessions.set(sessionId, kept);
    if (this.active && !kept.includes(this.active.turn)) this.active = undefined;
  }

  /** Closes the open turn without recording anything further to it. */
  endTurn(): void {
    this.active = undefined;
  }

  /** Session item index to fork at for a checkpoint, if it is still known. */
  forkPoint(sessionId: string, turnId: string): number | undefined {
    return this.turnsFor(sessionId).find(turn => turn.id === turnId)?.itemIndex;
  }

  clearSession(sessionId: string): void {
    this.bySessions.delete(sessionId);
    if (this.active?.sessionId === sessionId) this.active = undefined;
  }

  private turnsFor(sessionId: string): CheckpointTurn[] {
    const existing = this.bySessions.get(sessionId);
    if (existing) return existing;
    const created: CheckpointTurn[] = [];
    this.bySessions.set(sessionId, created);
    return created;
  }
}

function bound(change: CheckpointChange, maxTextBytes: number): CheckpointChange {
  const before = retain(change.beforeText, maxTextBytes);
  const after = retain(change.afterText, maxTextBytes);
  if (!before.tooLarge && !after.tooLarge) return change;
  return {
    ...change,
    beforeText: before.value,
    afterText: after.value,
    reversible: false,
    reason: 'The content was too large to retain for a checkpoint rewind.'
  };
}

function retain(text: string | null, maxTextBytes: number): { value: string | null; tooLarge: boolean } {
  if (text === null) return { value: null, tooLarge: false };
  if (Buffer.byteLength(text, 'utf8') > maxTextBytes) return { value: null, tooLarge: true };
  return { value: text, tooLarge: false };
}
