import { YisiTool } from '../../domain/tool';
import { randomUUID } from 'node:crypto';
import { GitPort, isDirtyGitEntry } from '../../domain/gitPort';
import {
  FileSystemPort,
  WorkspaceDirectoryCreation,
  WorkspaceDirectoryCreationResult,
  WorkspaceFileDeletion,
  WorkspaceFileDeletionResult,
  WorkspaceFileRename,
  WorkspaceFileRenameResult,
  WorkspaceTextFileRewrite,
  WorkspaceTextFileRewriteResult,
  WorkspaceTextReplacement,
  WorkspaceTextReplacementResult,
  WorkspaceTextFileCreation,
  WorkspaceTextFileCreationResult,
  WorkspaceWritePort
} from '../../context/workspaceContext';
import { DiagnosticProvider, DiagnosticSnapshot } from '../../domain/diagnostics';
import {
  EditJournalEntry,
  JournalMutationKind,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_TEXT_BYTES,
  countBytes,
  renderTextDiff,
  summarizeTextChange
} from './editJournal';
import { CheckpointChange, CheckpointRecorder } from './checkpointStore';

const MAX_PATH_CHARACTERS = 4_096;
const MAX_REPLACEMENT_CHARACTERS = 65_536;
const MAX_NEW_FILE_CHARACTERS = 262_144;

export class WorkspaceEditInputError extends Error {
  constructor(message = 'Invalid workspace edit input.') {
    super(message);
    this.name = 'WorkspaceEditInputError';
  }
}

export type PostEditDiagnosticEvidence =
  | { status: 'snapshot'; snapshot: DiagnosticSnapshot }
  | { status: 'unavailable' };

export interface WorkspaceMutationToolResult<T> {
  edit: T;
  diagnostics: PostEditDiagnosticEvidence;
}

export type WorkspaceEditToolResult = WorkspaceMutationToolResult<WorkspaceTextReplacementResult>;
export type WorkspaceFileCreationToolResult = WorkspaceMutationToolResult<WorkspaceTextFileCreationResult>;

/** Journal entry as exposed to the viewer (no retained raw content). */
export interface EditJournalViewEntry {
  id: string;
  kind: JournalMutationKind;
  path: string;
  reversibility: EditJournalEntry['reversibility'];
  reason?: string;
  addedLines?: number;
  removedLines?: number;
  addedPreview: string[];
  removedPreview: string[];
  /** True when it is the most recent entry (only that one can be undone). */
  isMostRecent: boolean;
}

/** Human-readable diff/description of one journaled change. */
export interface EditJournalDiff {
  id: string;
  kind: JournalMutationKind;
  path: string;
  text: string;
}

export class WorkspaceEditService {
  private readonly agentCreatedFiles = new Set<string>();
  private readonly journal: EditJournalEntry[] = [];

  constructor(
    private readonly files: WorkspaceWritePort,
    private readonly diagnostics?: DiagnosticProvider,
    private readonly reads?: FileSystemPort,
    private readonly git?: GitPort,
    private readonly workspaceRoot?: string,
    /**
     * Receives an invertible record of every successful mutation so a checkpoint
     * rewind can reach further back than the single-entry `undo_last_edit`. It is
     * a recorder, not a gate: it can never change what an edit does.
     */
    private readonly checkpoints?: CheckpointRecorder
  ) {}

  /**
   * Dirty-worktree delete/overwrite protection (docs/16 §14): refuse to delete
   * or rename a path that carries a tracked uncommitted change (modified,
   * staged, deleted, renamed, or added). Pure untracked files (the agent's own
   * new files) stay deletable. Non-repositories skip the guard entirely.
   */
  private async assertNotDirty(relPath: string, signal: AbortSignal): Promise<void> {
    if (!this.git || !this.workspaceRoot) return;
    const status = await this.git.status(this.workspaceRoot, signal);
    if (!status.isRepo) return;
    const rel = toPosix(relPath);
    const entry = status.entries.find(item => toPosix(item.path) === rel);
    if (entry && isDirtyGitEntry(entry)) {
      throw new WorkspaceEditInputError(
        `Refusing to mutate "${relPath}": it has uncommitted changes. Commit, stash, or restore it first.`
      );
    }
  }

  async replaceText(input: unknown, signal: AbortSignal): Promise<WorkspaceEditToolResult> {
    const replacement = parseReplacement(input);
    const before = await this.captureBefore(replacement.path, signal);
    const edit = await this.files.replaceText(replacement, signal);
    await this.recordJournal('replace_text', replacement.path, signal, {
      beforeSha256: edit.beforeSha256,
      afterSha256: edit.afterSha256,
      before: before
    });
    return this.withDiagnostics(edit, signal);
  }

  async createTextFile(input: unknown, signal: AbortSignal): Promise<WorkspaceFileCreationToolResult> {
    const creation = parseCreation(input);
    const edit = await this.files.createTextFile(creation, signal);
    // Whole-file rewrites later in the same run are restricted to paths the
    // agent itself created, so a model never silently clobbers user files.
    this.agentCreatedFiles.add(edit.path);
    await this.recordJournal('create_text_file', edit.path, signal, {
      beforeSha256: undefined,
      afterSha256: edit.sha256,
      afterText: creation.content
    });
    return this.withDiagnostics(edit, signal);
  }

  async rewriteTextFile(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceTextFileRewriteResult>> {
    const rewrite = parseRewrite(input);
    if (!this.agentCreatedFiles.has(rewrite.path)) {
      throw new WorkspaceEditInputError('Whole-file rewrites are only allowed for files created by the agent in this run; use replace_text for other files.');
    }
    const before = await this.captureBefore(rewrite.path, signal);
    const edit = await this.files.rewriteTextFile(rewrite, signal);
    await this.recordJournal('rewrite_text_file', edit.path, signal, {
      beforeSha256: edit.beforeSha256,
      afterSha256: edit.afterSha256,
      before: before,
      afterText: rewrite.content
    });
    return this.withDiagnostics(edit, signal);
  }

  async deleteFile(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceFileDeletionResult>> {
    const deletion = parseDeletion(input);
    await this.assertNotDirty(deletion.path, signal);
    const before = await this.captureBefore(deletion.path, signal);
    const edit = await this.files.deleteFile(deletion, signal);
    this.agentCreatedFiles.delete(edit.path);
    await this.recordJournal('delete_file', edit.path, signal, {
      beforeSha256: edit.beforeSha256,
      before: before
    });
    return this.withDiagnostics(edit, signal);
  }

  async renameFile(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceFileRenameResult>> {
    const rename = parseRename(input);
    await this.assertNotDirty(rename.fromPath, signal);
    const edit = await this.files.renameFile(rename, signal);
    if (this.agentCreatedFiles.has(edit.fromPath)) {
      this.agentCreatedFiles.delete(edit.fromPath);
      this.agentCreatedFiles.add(edit.toPath);
    }
    this.journal.push({
      id: randomJournalId(),
      kind: 'rename_file',
      path: edit.toPath,
      reversibility: 'reversible',
      capturedToPath: edit.fromPath
    });
    this.trimJournal();
    // Checkpoint convention: `path` is the source (before) and `toPath` the
    // destination (after), so the inverse is a rename from `toPath` back to `path`.
    this.checkpoints?.record({
      kind: 'rename_file',
      path: edit.fromPath,
      toPath: edit.toPath,
      beforeText: null,
      afterText: null,
      reversible: true
    });
    return this.withDiagnostics(edit, signal);
  }

  async createDirectory(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceDirectoryCreationResult>> {
    const creation = parseDirectoryCreation(input);
    const edit = await this.files.createDirectory(creation, signal);
    this.journal.push({
      id: randomJournalId(),
      kind: 'create_directory',
      path: edit.path,
      reversibility: 'non-reversible',
      reason: 'Directory removal is not automated; delete files first if you created them here.'
    });
    this.trimJournal();
    this.checkpoints?.record({
      kind: 'create_directory',
      path: edit.path,
      beforeText: null,
      afterText: null,
      reversible: false,
      reason: 'Directory removal is not automated; delete files first if you created them here.'
    });
    return this.withDiagnostics(edit, signal);
  }

  /**
   * Inverts one recorded change, as part of a user-initiated checkpoint rewind.
   *
   * This is deliberately **not** an agent tool: a rewind is the user reverting the
   * agent, so it is not subject to the agent-only restrictions (such as "rewrite
   * only files this run created"). It keeps the parts that protect the user: the
   * stale guard (a file edited since the agent touched it is refused, never
   * clobbered), the workspace boundary and the sensitive-path rules — all of which
   * live in the write port below this call.
   */
  async restoreFromCheckpoint(
    change: CheckpointChange,
    signal: AbortSignal
  ): Promise<{ path: string; restored: boolean; reason?: string }> {
    if (!change.reversible) {
      return {
        path: change.path,
        restored: false,
        reason: change.reason ?? 'This change was not retained, so it cannot be rewound automatically.'
      };
    }
    try {
      signal.throwIfAborted();
      switch (change.kind) {
        case 'create_text_file': {
          // The file did not exist before this change, so removing it is the
          // target state; a file that is already gone is a success, not a failure.
          try {
            await this.files.deleteFile({ path: change.path }, signal);
          } catch (error) {
            if (signal.aborted) throw error;
            return { path: change.path, restored: true };
          }
          this.agentCreatedFiles.delete(change.path);
          break;
        }
        case 'delete_file': {
          if (change.beforeText === null) {
            return { path: change.path, restored: false, reason: 'The deleted content was not retained.' };
          }
          const created = await this.files.createTextFile({ path: change.path, content: change.beforeText }, signal);
          this.agentCreatedFiles.add(created.path);
          break;
        }
        case 'replace_text':
        case 'rewrite_text_file': {
          if (change.beforeText === null) {
            return { path: change.path, restored: false, reason: 'The previous content was not retained.' };
          }
          if (!change.afterSha256) {
            return { path: change.path, restored: false, reason: 'The expected file version was not recorded.' };
          }
          await this.files.rewriteTextFile(
            { path: change.path, expectedSha256: change.afterSha256, content: change.beforeText },
            signal
          );
          break;
        }
        case 'rename_file': {
          if (!change.toPath) {
            return { path: change.path, restored: false, reason: 'The rename destination was not recorded.' };
          }
          await this.files.renameFile({ fromPath: change.toPath, toPath: change.path }, signal);
          break;
        }
        default:
          return { path: change.path, restored: false, reason: `Rewinding ${change.kind} is not automated.` };
      }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : 'Unknown rewind failure.';
      return { path: change.path, restored: false, reason: message };
    }
    return { path: change.path, restored: true };
  }

  /** Revert the most recent journaled workspace write (LIFO, stale-guarded). */
  async undoLastEdit(input: unknown, signal: AbortSignal): Promise<{ undone: boolean; kind?: string; path?: string; reason?: string }> {
    if (!isRecord(input) || Object.keys(input).length > 0) {
      throw new WorkspaceEditInputError('The undo tool takes no input.');
    }
    const entry = this.journal[this.journal.length - 1];
    if (!entry) return { undone: false, reason: 'No agent workspace edits to undo in this run.' };
    if (entry.reversibility === 'non-reversible') {
      return { undone: false, reason: entry.reason ?? `Cannot undo ${entry.kind} automatically.` };
    }
    try {
      signal?.throwIfAborted();
      switch (entry.kind) {
        case 'create_text_file':
          await this.files.deleteFile({ path: entry.path }, signal);
          this.agentCreatedFiles.delete(entry.path);
          break;
        case 'delete_file': {
          if (entry.capturedBeforeText === undefined) {
            return { undone: false, reason: 'Deleted content was too large to retain for undo.' };
          }
          const restored = await this.files.createTextFile({ path: entry.path, content: entry.capturedBeforeText }, signal);
          this.agentCreatedFiles.add(restored.path);
          break;
        }
        case 'replace_text':
        case 'rewrite_text_file': {
          if (entry.capturedBeforeText === undefined) {
            return { undone: false, reason: 'Original content was too large to retain for undo.' };
          }
          if (entry.afterSha256) {
            const current = await this.readSha(entry.path, signal);
            if (current !== entry.afterSha256) {
              return { undone: false, reason: 'The file changed after the edit; refusing to revert stale state.' };
            }
          }
          await this.files.rewriteTextFile(
            { path: entry.path, expectedSha256: entry.afterSha256 ?? '0'.repeat(64), content: entry.capturedBeforeText },
            signal
          );
          break;
        }
        case 'rename_file': {
          if (entry.capturedToPath === undefined) {
            return { undone: false, reason: 'Rename origin was not recorded.' };
          }
          await this.files.renameFile({ fromPath: entry.path, toPath: entry.capturedToPath }, signal);
          if (this.agentCreatedFiles.has(entry.path)) {
            this.agentCreatedFiles.delete(entry.path);
            this.agentCreatedFiles.add(entry.capturedToPath);
          }
          break;
        }
        default:
          return { undone: false, reason: `Cannot undo ${entry.kind}.` };
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : 'Unknown undo failure';
      return { undone: false, reason: `Undo failed: ${message}` };
    }
    this.journal.pop();
    return { undone: true, kind: entry.kind, path: entry.path };
  }

  /** Snapshot of the journal for the viewer (recent entry flagged). */
  journalSnapshot(): EditJournalViewEntry[] {
    const mostRecentId = this.journal.length > 0 ? this.journal[this.journal.length - 1].id : undefined;
    return this.journal.map(entry => ({
      id: entry.id,
      kind: entry.kind,
      path: entry.path,
      reversibility: entry.reversibility,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.summary !== undefined ? { addedLines: entry.summary.addedLines, removedLines: entry.summary.removedLines } : {}),
      addedPreview: entry.summary?.addedPreview ?? [],
      removedPreview: entry.summary?.removedPreview ?? [],
      isMostRecent: entry.id === mostRecentId
    }));
  }

  /** Human-readable diff/description of one journaled change. */
  journalDiffText(entryId: string): EditJournalDiff | undefined {
    const entry = this.journal.find(candidate => candidate.id === entryId);
    if (!entry) return undefined;
    let text: string;
    if (entry.capturedBeforeText !== undefined && entry.capturedAfterText !== undefined) {
      text = renderTextDiff(entry.capturedBeforeText, entry.capturedAfterText, `${entry.path} · ${entry.kind}`);
    } else if (entry.kind === 'rename_file' && entry.capturedToPath !== undefined) {
      text = `renamed ${entry.capturedToPath} → ${entry.path}`;
    } else if (entry.kind === 'create_text_file') {
      text = `${entry.path}: created (content not retained in the journal)`;
    } else if (entry.capturedBeforeText !== undefined) {
      text = renderTextDiff(entry.capturedBeforeText, '', `${entry.path} · ${entry.kind}`);
    } else {
      text = `${entry.kind} ${entry.path}: full content not retained; ${entry.reason ?? 'no inline diff available'}`;
    }
    return { id: entry.id, kind: entry.kind, path: entry.path, text };
  }

  private async captureBefore(relativePath: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.reads) return undefined;
    try {
      const content = await this.reads.readFile(relativePath, signal);
      if (countBytes(content.text) <= MAX_JOURNAL_TEXT_BYTES) return content.text;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async readSha(relativePath: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.reads) return undefined;
    try {
      const content = await this.reads.readFile(relativePath, signal);
      return content.sha256;
    } catch {
      return undefined;
    }
  }

  private async recordJournal(
    kind: JournalMutationKind,
    path: string,
    signal: AbortSignal,
    evidence: {
      beforeSha256?: string;
      afterSha256?: string;
      before?: string;
      afterText?: string;
    }
  ): Promise<void> {
    const entry: EditJournalEntry = {
      id: randomJournalId(),
      kind,
      path,
      beforeSha256: evidence.beforeSha256,
      afterSha256: evidence.afterSha256,
      reversibility: 'non-reversible'
    };
    const after = evidence.afterText ?? (await this.readAfterText(path, signal));
    if (evidence.before !== undefined && after !== undefined) {
      entry.capturedBeforeText = evidence.before;
      entry.capturedAfterText = after;
      entry.summary = summarizeTextChange(evidence.before, after);
      entry.reversibility = 'reversible';
    } else if (kind === 'create_text_file') {
      // Reversible through delete without retaining content.
      entry.reversibility = 'reversible';
    } else if (kind === 'delete_file' && evidence.before !== undefined) {
      entry.capturedBeforeText = evidence.before;
      entry.reversibility = 'reversible';
    } else if (kind === 'rename_file') {
      // Reversible through a reverse rename without retaining content.
      entry.reversibility = 'reversible';
    } else {
      entry.reversibility = 'non-reversible';
      entry.reason = kind === 'delete_file'
        ? 'Deleted content was too large to retain for undo.'
        : 'Original content was too large to retain for undo, or the file was not readable.';
    }
    this.journal.push(entry);
    this.trimJournal();
    this.checkpoints?.record({
      kind: entry.kind,
      path: entry.path,
      beforeText: entry.capturedBeforeText ?? null,
      afterText: entry.capturedAfterText ?? null,
      ...(entry.beforeSha256 !== undefined ? { beforeSha256: entry.beforeSha256 } : {}),
      ...(entry.afterSha256 !== undefined ? { afterSha256: entry.afterSha256 } : {}),
      reversible: entry.reversibility === 'reversible',
      ...(entry.reason !== undefined ? { reason: entry.reason } : {})
    });
  }

  private async readAfterText(relativePath: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.reads) return undefined;
    try {
      const content = await this.reads.readFile(relativePath, signal);
      if (countBytes(content.text) <= MAX_JOURNAL_TEXT_BYTES) return content.text;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private trimJournal(): void {
    while (this.journal.length > MAX_JOURNAL_ENTRIES) {
      this.journal.shift();
    }
  }

  private async withDiagnostics<T>(edit: T, signal: AbortSignal): Promise<WorkspaceMutationToolResult<T>> {
    return { edit, diagnostics: await this.readDiagnosticsAfterMutation(signal) };
  }

  private async readDiagnosticsAfterMutation(signal: AbortSignal): Promise<PostEditDiagnosticEvidence> {
    if (!this.diagnostics || signal.aborted) return { status: 'unavailable' };
    try {
      const snapshot = await this.diagnostics.read(signal);
      return snapshot.available
        ? { status: 'snapshot', snapshot: structuredClone(snapshot) }
        : { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  }
}

export function createWorkspaceEditTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'replace_text',
    description: 'Replace exactly one occurrence in an existing UTF-8 workspace file. First read the file and pass its sha256 as expectedSha256.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        oldText: { type: 'string', minLength: 1, maxLength: MAX_REPLACEMENT_CHARACTERS },
        newText: { type: 'string', maxLength: MAX_REPLACEMENT_CHARACTERS }
      },
      required: ['path', 'expectedSha256', 'oldText', 'newText'],
      additionalProperties: false
    },
    execute: (input, context) => service.replaceText(input, context.signal)
  };
}

export function createWorkspaceFileTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'create_text_file',
    description: 'Create one new UTF-8 file in an existing workspace directory. This never overwrites an existing path.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        content: { type: 'string', maxLength: MAX_NEW_FILE_CHARACTERS }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    execute: (input, context) => service.createTextFile(input, context.signal)
  };
}

export function createWorkspaceRewriteTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'rewrite_text_file',
    description:
      'Replace the whole content of a file the agent created earlier in this run via create_text_file '
      + '(newly created test/doc files, follow-ups, fixes). Pass the current sha256 from read_file. '
      + 'For other files use replace_text with the exact old fragment.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        content: { type: 'string', maxLength: MAX_NEW_FILE_CHARACTERS }
      },
      required: ['path', 'expectedSha256', 'content'],
      additionalProperties: false
    },
    execute: (input, context) => service.rewriteTextFile(input, context.signal)
  };
}

export function createWorkspaceDeleteTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'delete_file',
    description:
      'Delete one regular UTF-8 text file inside the workspace. Never deletes directories; '
      + 'credential-sensitive paths are rejected. The agent may not delete through symbolic links.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: (input, context) => service.deleteFile(input, context.signal)
  };
}

export function createWorkspaceRenameTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'rename_file',
    description:
      'Rename or move one file to another workspace-relative path. Never overwrites an existing target. '
      + 'Useful before replacing stale generated files or reorganizing agent-created tests.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        fromPath: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        toPath: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['fromPath', 'toPath'],
      additionalProperties: false
    },
    execute: (input, context) => service.renameFile(input, context.signal)
  };
}

export function createWorkspaceDirectoryTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'create_directory',
    description: 'Create one directory (and any missing parents) inside the workspace, e.g. a tests/ folder.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: (input, context) => service.createDirectory(input, context.signal)
  };
}

export function createUndoLastEditTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'undo_last_edit',
    description:
      'Revert the most recent workspace write the agent made in this run '
      + '(create/delete/replace/rewrite/rename). Stale-guarded: refuses when the file '
      + 'changed afterwards. Directory creation and oversized edits are not automatically '
      + 'revertible and are reported honestly. Takes no input.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: (input, context) => service.undoLastEdit(input, context.signal)
  };
}

function parseReplacement(value: unknown): WorkspaceTextReplacement {
  if (!isExactRecord(value, ['path', 'expectedSha256', 'oldText', 'newText'])) {
    throw new WorkspaceEditInputError();
  }
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.expectedSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
    || !isBoundedNonEmpty(value.oldText, MAX_REPLACEMENT_CHARACTERS)
    || typeof value.newText !== 'string'
    || value.newText.length > MAX_REPLACEMENT_CHARACTERS
    || value.newText.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return {
    path: value.path.trim(),
    expectedSha256: value.expectedSha256,
    oldText: value.oldText,
    newText: value.newText
  };
}

function parseCreation(value: unknown): WorkspaceTextFileCreation {
  if (!isExactRecord(value, ['path', 'content'])) throw new WorkspaceEditInputError();
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.content !== 'string'
    || value.content.length > MAX_NEW_FILE_CHARACTERS
    || value.content.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return { path: value.path.trim(), content: value.content };
}

function parseRewrite(value: unknown): WorkspaceTextFileRewrite {
  if (!isExactRecord(value, ['path', 'expectedSha256', 'content'])) throw new WorkspaceEditInputError();
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.expectedSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
    || typeof value.content !== 'string'
    || value.content.length > MAX_NEW_FILE_CHARACTERS
    || value.content.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return { path: value.path.trim(), expectedSha256: value.expectedSha256, content: value.content };
}

function parseDeletion(value: unknown): WorkspaceFileDeletion {
  if (!isExactRecord(value, ['path'])) throw new WorkspaceEditInputError();
  if (!isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)) throw new WorkspaceEditInputError();
  return { path: value.path.trim() };
}

function parseRename(value: unknown): WorkspaceFileRename {
  if (!isExactRecord(value, ['fromPath', 'toPath'])) throw new WorkspaceEditInputError();
  if (
    !isBoundedNonBlank(value.fromPath, MAX_PATH_CHARACTERS)
    || !isBoundedNonBlank(value.toPath, MAX_PATH_CHARACTERS)
  ) {
    throw new WorkspaceEditInputError();
  }
  return { fromPath: value.fromPath.trim(), toPath: value.toPath.trim() };
}

function parseDirectoryCreation(value: unknown): WorkspaceDirectoryCreation {
  if (!isExactRecord(value, ['path'])) throw new WorkspaceEditInputError();
  if (!isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)) throw new WorkspaceEditInputError();
  return { path: value.path.trim() };
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function randomJournalId(): string {
  return randomUUID();
}

function isBoundedNonBlank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function isBoundedNonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}
