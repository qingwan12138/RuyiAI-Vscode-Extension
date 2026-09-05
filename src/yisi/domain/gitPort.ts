/**
 * Git port. Kept in the domain so neither the agent core nor the permission
 * engine depends on the concrete `git` CLI: the infrastructure adapter owns
 * any future Remote/platform differences (see docs/16 §19).
 */
export interface GitStatusEntry {
  /** Workspace-relative path (POSIX separators), e.g. "src/main.ts". */
  path: string;
  /** Porcelain XY status, e.g. " M" (worktree mod), "M " (staged), "??". */
  status: string;
  /** Rename/copy source path when `status` is R/C. */
  renamedFrom?: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  /** True when there are no entries at all (clean). */
  clean: boolean;
  /** Capped list of changed entries. */
  entries: GitStatusEntry[];
  /** A capped raw portion of `git status --porcelain=v1` for diagnostics. */
  raw: string;
}

export interface GitPort {
  /** True when `cwd` is inside a git working tree. Never throws (false on error). */
  isRepo(cwd: string, signal?: AbortSignal): Promise<boolean>;
  /** Porcelain status of the repo containing `cwd`. Empty result on non-repo. */
  status(cwd: string, signal?: AbortSignal): Promise<GitStatusResult>;
  /** True when there are uncommitted (index/worktree) changes, excluding ignored. */
  hasUncommittedChanges(cwd: string, signal?: AbortSignal): Promise<boolean>;
}

/**
 * A porcelain entry counts as "dirty work" (worth protecting from a destructive
 * workspace mutation) when it reflects a tracked-baseline change: modified,
 * staged, deleted, renamed, or added to the index. Pure untracked files ("??")
 * are usually agent-created and must remain deletable by the agent.
 */
export function isDirtyGitEntry(entry: { status: string }): boolean {
  return entry.status !== '??';
}
