import { GitPort, GitStatusResult, isDirtyGitEntry } from '../../domain/gitPort';
import { ProcessRunner } from '../../domain/process';

const MAX_STATUS_BYTES = 64 * 1024;
const MAX_STATUS_ENTRIES = 2_000;
const GIT_TIMEOUT_MS = 30_000;
// Do not quote/escape non-ASCII paths so Chinese/space paths stay readable and
// match the workspace-relative paths we compare against.
const GIT_CONFIG_ARGS = ['-c', 'core.quotepath=false'];

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

export class NodeGitService implements GitPort {
  constructor(private readonly runner: Pick<ProcessRunner, 'run'>) {}

  async isRepo(cwd: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree'], cwd, signal);
    return result.status === 'exited' && result.exitCode === 0;
  }

  async status(cwd: string, signal?: AbortSignal): Promise<GitStatusResult> {
    const result = await this.run(['status', '--porcelain=v1', '-b'], cwd, signal);
    if (result.status !== 'exited' || result.exitCode !== 0) {
      return { isRepo: false, branch: null, clean: true, entries: [], raw: '' };
    }
    return parsePorcelain(result.stdout.text);
  }

  async hasUncommittedChanges(cwd: string, signal?: AbortSignal): Promise<boolean> {
    const status = await this.status(cwd, signal);
    return status.isRepo && !status.clean;
  }

  private async run(
    args: string[],
    cwd: string,
    signal?: AbortSignal
  ): Promise<{ status: string; exitCode: number | null; stdout: { text: string }; stderr: { text: string } }> {
    if (signal?.aborted) throw abortError();
    return this.runner.run(
      {
        executable: 'git',
        args: [...GIT_CONFIG_ARGS, ...args],
        cwd,
        timeoutMs: GIT_TIMEOUT_MS,
        outputLimitBytes: MAX_STATUS_BYTES
      },
      signal ?? new AbortController().signal
    );
  }
}

/** Parse `git status --porcelain=v1 -b` output into a bounded result. */
export function parsePorcelain(text: string): GitStatusResult {
  const lines = toPosix(text).split('\n').filter(line => line.length > 0);
  let branch: string | null = null;
  const entries: GitStatusResult['entries'] = [];
  const rawLines: string[] = [];

  for (const line of lines) {
    rawLines.push(line);
    if (line.startsWith('## ')) {
      const rest = line.slice(3);
      branch = rest.split('...')[0].trim() || 'HEAD';
      continue;
    }
    if (entries.length >= MAX_STATUS_ENTRIES) continue;
    const entry = parsePorcelainLine(line);
    if (entry) entries.push(entry);
  }

  return {
    isRepo: true,
    branch,
    clean: entries.length === 0,
    entries,
    raw: rawLines.slice(0, MAX_STATUS_ENTRIES).join('\n')
  };
}

function parsePorcelainLine(line: string): { path: string; status: string; renamedFrom?: string } | undefined {
  if (line.length < 4) return undefined;
  const status = line.slice(0, 2); // e.g. " M", "??", "R "
  // Path starts after the 2 status chars, a space, then (for rename/copy) "old -> new".
  let rest = line.slice(3);
  let renamedFrom: string | undefined;
  const arrow = rest.indexOf(' -> ');
  if (arrow >= 0) {
    renamedFrom = rest.slice(0, arrow);
    rest = rest.slice(arrow + 4);
  }
  return { path: rest, status, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
}

/** True when the entry represents a tracked baseline change (not pure untracked). */
export { isDirtyGitEntry };

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}
