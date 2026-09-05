/**
 * Git worktree port. Kept in the domain so the Agent core does not depend on
 * the concrete `git` CLI (docs/16 §14, §19). All operations go through the
 * infrastructure adapter which owns the structured spawn and the porcelain
 * parsing.
 */
export interface WorktreeInfo {
  /** Absolute path of the worktree. */
  path: string;
  /** Branch name, or null when detached. */
  branch: string | null;
  /** True for the main working tree (the first `git worktree list` entry). */
  isCurrent: boolean;
}

export interface CreateWorktreeRequest {
  /** Absolute path for the new worktree (caller chooses location). */
  path: string;
  /** Branch to create/checkout; defaults to a session branch at HEAD. */
  branch: string;
  /** Base ref to branch from; defaults to HEAD (no default-branch assumption). */
  base?: string;
}

export interface WorktreePort {
  /** True when `cwd` is inside a git working tree. Never throws (false on error). */
  isRepo(cwd: string, signal?: AbortSignal): Promise<boolean>;
  /** List all worktrees of the repo containing `cwd`. */
  list(cwd: string, signal?: AbortSignal): Promise<WorktreeInfo[]>;
  /** Create an isolated worktree. Refuses when the repo is not a git repo. */
  create(cwd: string, request: CreateWorktreeRequest, signal?: AbortSignal): Promise<WorktreeInfo>;
  /** Remove a worktree. Refuses when it has uncommitted changes unless `force`. */
  remove(cwd: string, path: string, opts?: { force?: boolean }, signal?: AbortSignal): Promise<void>;
}
