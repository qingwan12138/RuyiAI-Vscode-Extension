import { WorktreeInfo, WorktreePort, CreateWorktreeRequest } from '../../domain/worktreePort';
import { ProcessRunner } from '../../domain/process';

const WORKTREE_TIMEOUT_MS = 30_000;
const GIT_CONFIG_ARGS = ['-c', 'core.quotepath=false'];

export class NodeWorktreeManager implements WorktreePort {
  constructor(private readonly runner: Pick<ProcessRunner, 'run'>) {}

  async isRepo(cwd: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree'], cwd, signal);
    return result.status === 'exited' && result.exitCode === 0;
  }

  async list(cwd: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
    const result = await this.run(['worktree', 'list', '--porcelain'], cwd, signal);
    if (result.status !== 'exited' || result.exitCode !== 0) return [];
    return parseWorktreeList(result.stdout.text);
  }

  async create(cwd: string, request: CreateWorktreeRequest, signal?: AbortSignal): Promise<WorktreeInfo> {
    if (!(await this.isRepo(cwd, signal))) {
      throw new Error('Cannot create a git worktree outside a git repository.');
    }
    const args = ['worktree', 'add', '-b', request.branch, request.path];
    if (request.base) args.push(request.base);
    const result = await this.run(args, cwd, signal);
    if (result.status !== 'exited' || result.exitCode !== 0) {
      throw worktreeError(result);
    }
    return { path: request.path, branch: request.branch, isCurrent: false };
  }

  async remove(cwd: string, path: string, opts: { force?: boolean } = {}, signal?: AbortSignal): Promise<void> {
    if (!(await this.isRepo(cwd, signal))) {
      throw new Error('Cannot remove a git worktree outside a git repository.');
    }
    // Never mutate `.git/worktrees` metadata directly: always go through git.
    const args = ['worktree', 'remove', path];
    if (opts.force) args.push('--force');
    const result = await this.run(args, cwd, signal);
    if (result.status !== 'exited' || result.exitCode !== 0) {
      // A dirty worktree refuses removal without --force; surface a recovery hint.
      const err = worktreeError(result);
      throw new Error(`${err.message} If it has uncommitted changes, commit or stash them first (or pass force:true).`);
    }
  }

  private async run(
    args: string[],
    cwd: string,
    signal?: AbortSignal
  ): Promise<{ status: string; exitCode: number | null; stdout: { text: string }; stderr: { text: string } }> {
    if (signal?.aborted) throw abortError();
    return this.runner.run(
      { executable: 'git', args: [...GIT_CONFIG_ARGS, ...args], cwd, timeoutMs: WORKTREE_TIMEOUT_MS },
      signal ?? new AbortController().signal
    );
  }
}

/** Parse `git worktree list --porcelain` into entries (first = current/main). */
export function parseWorktreeList(text: string): WorktreeInfo[] {
  const blocks = text.split(/\n\s*\n/).filter(block => block.trim().length > 0);
  const entries: WorktreeInfo[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let path = '';
    let branch: string | null = null;
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).replace(/\\/g, '/');
      else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length); // e.g. refs/heads/main
        branch = ref.split('/').slice(2).join('/');
      }
    }
    if (path) entries.push({ path, branch, isCurrent: entries.length === 0 });
  }
  return entries;
}

function worktreeError(result: { status: string; exitCode: number | null; stderr: { text: string } }): Error {
  const message = (result.stderr.text || 'git worktree command failed.').trim().split('\n')[0].slice(0, 240);
  return new Error(message || 'git worktree command failed.');
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}
