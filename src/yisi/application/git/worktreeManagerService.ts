import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorktreeInfo, WorktreePort } from '../../domain/worktreePort';
import { GitPort } from '../../domain/gitPort';
import { YisiTool } from '../../domain/tool';

export interface IsolatedWorkspace {
  /** Absolute path of the isolated worktree. */
  root: string;
  branch: string;
}

export class WorktreeManagerService {
  constructor(
    private readonly worktrees: WorktreePort,
    private readonly git: GitPort
  ) {}

  async list(baseRepo: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
    return this.worktrees.list(baseRepo, signal);
  }

  async hasUncommittedChanges(baseRepo: string, signal?: AbortSignal): Promise<boolean> {
    return this.git.hasUncommittedChanges(baseRepo, signal);
  }

  /**
   * Isolate a write session on its own worktree so it never edits the shared
   * working tree (v0.4 DoD). Branches from HEAD (no default-branch assumption).
   */
  async createSessionWorktree(
    baseRepo: string,
    sessionId: string,
    worktreesDir: string,
    signal?: AbortSignal
  ): Promise<IsolatedWorkspace> {
    const branch = `yisi/session-${sessionId}`;
    const root = path.join(worktreesDir, `session-${sessionId}`);
    const created = await this.worktrees.create(baseRepo, { path: root, branch }, signal);
    return { root: created.path, branch: created.branch ?? branch };
  }

  /** Remove a session worktree. Refuses dirty unless `force`. */
  async remove(baseRepo: string, path: string, force: boolean, signal?: AbortSignal): Promise<void> {
    return this.worktrees.remove(baseRepo, path, { force }, signal);
  }
}

export interface GitWorktreeInput {
  action: 'list' | 'remove';
  path?: string;
  force?: boolean;
}

export function createGitWorktreeTool(service: WorktreeManagerService, baseRepo: string): YisiTool {
  return {
    id: 'git_worktree',
    description:
      'List the git worktrees of the active repository, or remove an isolated session worktree. Create/remove mutate the repo state and are permission-gated; dirty worktrees refuse removal unless force.',
    risk: 'processExec',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'remove'] },
        path: { type: 'string', minLength: 1, maxLength: 4_096 },
        force: { type: 'boolean' }
      },
      required: ['action'],
      additionalProperties: false
    },
    execute: async (input: GitWorktreeInput, context) => {
      if (input.action === 'list') {
        const worktrees = await service.list(baseRepo, context.signal);
        return { worktrees: worktrees.map(item => ({ path: item.path, branch: item.branch, isCurrent: item.isCurrent })) };
      }
      if (typeof input.path !== 'string' || !input.path.trim()) {
        throw new Error('git_worktree: remove requires a path.');
      }
      await service.remove(baseRepo, input.path, input.force === true, context.signal);
      return { removed: input.path };
    }
  };
}

/** Stable id for a fresh session isolation branch. */
export function sessionBranchId(): string {
  return randomUUID();
}
