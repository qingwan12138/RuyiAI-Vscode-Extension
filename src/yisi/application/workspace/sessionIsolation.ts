import { pathToFileURL } from 'node:url';
import { PermissionMode } from '../../domain/session';
import { AgentChatRunner } from '../agent/agentChatRunner';
import { AgentConversationRunner } from '../chat/chatService';
import { WorktreeManagerService } from '../git/worktreeManagerService';

export interface SessionRunnerResolver {
  /** Runner for a session, or undefined to run on the shared workspace. */
  resolve(session: { sessionId: string; mode: PermissionMode }): Promise<AgentConversationRunner | undefined>;
  /** Release a session's isolated worktree (does not throw on failure). */
  cleanup(sessionId: string): Promise<void>;
}

/**
 * v0.4 DoD: two write sessions must not modify the same working tree. A
 * write-capable session (mode !== 'plan') is isolated onto its own git worktree
 * with its own runner. Read-only (plan) sessions stay on the shared tree. The
 * runner builder is injected so the application layer never imports vscode or
 * the concrete file-system adapter.
 */
export class SessionIsolationService implements SessionRunnerResolver {
  private readonly cache = new Map<string, { runner: AgentChatRunner; root: string }>();

  constructor(
    private readonly baseRepo: string,
    private readonly worktreesDir: string,
    private readonly worktrees: WorktreeManagerService,
    private readonly buildRunner: (root: string, uri: string) => Promise<AgentChatRunner>
  ) {}

  async resolve(session: { sessionId: string; mode: PermissionMode }): Promise<AgentConversationRunner | undefined> {
    if (session.mode === 'plan') return undefined;
    const cached = this.cache.get(session.sessionId);
    if (cached) return cached.runner;
    const isolated = await this.worktrees.createSessionWorktree(this.baseRepo, session.sessionId, this.worktreesDir);
    const runner = await this.buildRunner(isolated.root, pathToFileURL(isolated.root).href);
    this.cache.set(session.sessionId, { runner, root: isolated.root });
    return runner;
  }

  async cleanup(sessionId: string): Promise<void> {
    const cached = this.cache.get(sessionId);
    if (!cached) return;
    this.cache.delete(sessionId);
    await this.worktrees.remove(this.baseRepo, cached.root, true).catch(() => undefined);
  }
}
