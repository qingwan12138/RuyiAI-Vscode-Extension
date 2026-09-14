import { ChildProcess, spawn } from 'node:child_process';
import { HookExecutionResult, HookExecutor } from '../../application/hooks/hookService';
import { ConfiguredHook } from '../../application/hooks/hookConfiguration';
import { createDefaultProcessTreeController, ProcessTreeController } from '../process/processTreeController';

/**
 * Runs one hook as a child process.
 *
 * Contract (documented in docs/20 and ADR-0006):
 *  - the event payload arrives as **JSON on stdin**, followed by EOF;
 *  - **stdout** is empty, or a JSON object `{ decision?, reason?, context? }`.
 *    A post-tool hook may also print plain text, which is taken as context —
 *    "run the linter, print what it said" is the natural shape for feedback. A
 *    pre-tool hook must print JSON or nothing, because a decision needs structure
 *    and guessing at prose would be worse than refusing to guess;
 *  - `decision` may only be `allow` or `deny`. There is no approval verdict, so a
 *    hook has no way to widen what the permission engine permits (domain/hookPort);
 *  - stderr is captured, bounded, and used to explain failures.
 *
 * Process rules match the rest of the extension (docs/16): exact argv with
 * `shell: false`, a timeout, cancellation, and process-group termination on Linux
 * so a hook script's own children cannot be orphaned.
 */

export interface NodeHookExecutorOptions {
  treeController?: ProcessTreeController;
  /** Working directory for the hook process — normally the execution root. */
  cwd?: string;
  maxStdoutCharacters?: number;
  maxStderrCharacters?: number;
}

const DEFAULT_MAX_STDOUT = 1_000_000;
const DEFAULT_MAX_STDERR = 4_000;
const ERROR_REASON_CHARACTERS = 600;

export class NodeHookExecutor implements HookExecutor {
  private readonly tree: ProcessTreeController;

  constructor(private readonly options: NodeHookExecutorOptions = {}) {
    this.tree = options.treeController ?? createDefaultProcessTreeController();
  }

  execute(hook: ConfiguredHook, payload: unknown, signal: AbortSignal): Promise<HookExecutionResult> {
    // Checked before spawning: an already-cancelled run must not start a process.
    if (signal.aborted) return Promise.resolve({ error: 'The run was cancelled.' });
    return new Promise<HookExecutionResult>(resolve => {
      let settled = false;
      let child: ChildProcess | undefined;
      let stdout = '';
      let stderr = '';
      let failure: string | undefined;

      const maxStdout = this.options.maxStdoutCharacters ?? DEFAULT_MAX_STDOUT;
      const maxStderr = this.options.maxStderrCharacters ?? DEFAULT_MAX_STDERR;

      const finish = (result: HookExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const stop = (reason: string): void => {
        failure ??= reason;
        if (!child) {
          finish({ error: bound(reason, ERROR_REASON_CHARACTERS) });
          return;
        }
        void this.tree.terminate(child, 500).then(() => {
          // Settle here as well as in 'close': a hook that never finishes must not
          // be able to hang an agent run, and not every platform emits a close
          // event after a forced kill.
          finish({ error: bound(withStderr(failure ?? reason, stderr), ERROR_REASON_CHARACTERS) });
        });
      };

      const onAbort = (): void => stop('The run was cancelled.');
      const timer = setTimeout(() => stop(`the hook did not finish within ${hook.timeoutMs}ms`), hook.timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        child = spawn(hook.command, [...hook.args], {
          shell: false,
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: this.tree.detached,
          windowsHide: true
        });
      } catch (error) {
        finish({ error: bound(describeError(error), ERROR_REASON_CHARACTERS) });
        return;
      }

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length < maxStdout) stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-maxStderr);
      });
      child.once('error', error => finish({ error: bound(describeError(error), ERROR_REASON_CHARACTERS) }));
      child.once('close', (code, closeSignal) => {
        if (settled) return;
        if (failure) {
          finish({ error: bound(withStderr(failure, stderr), ERROR_REASON_CHARACTERS) });
          return;
        }
        const parsed = parseHookOutput(hook, stdout);
        if ('error' in parsed) {
          const status = closeSignal ? `signal ${closeSignal}` : `exit code ${code}`;
          finish({ error: bound(withStderr(`${parsed.error} (${status})`, stderr), ERROR_REASON_CHARACTERS) });
          return;
        }
        if (code !== 0 && !parsed.result.decision && !parsed.result.context) {
          finish({ error: bound(withStderr(`the hook exited with code ${code}`, stderr), ERROR_REASON_CHARACTERS) });
          return;
        }
        finish(parsed.result);
      });

      // A hook that ignores stdin must not block the write: ignore EPIPE.
      child.stdin?.on('error', () => undefined);
      try {
        child.stdin?.end(`${JSON.stringify(payload)}\n`);
      } catch {
        // The child may already be gone; the close handler reports the outcome.
      }
    });
  }
}

function parseHookOutput(
  hook: ConfiguredHook,
  raw: string
): { result: HookExecutionResult } | { error: string } {
  const text = raw.trim();
  if (!text) return { result: {} };

  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(text);
  } catch {
    isJson = false;
  }

  if (!isJson) {
    // Plain text is a natural way to hand back feedback; it cannot express a
    // decision, so it is only accepted where a decision is not the point.
    if (hook.event === 'postToolUse') return { result: { context: bound(text, 8_000) } };
    return { error: 'output is not JSON; a pre-tool hook must print {"decision":"allow"|"deny"} or nothing' };
  }

  if (!isRecord(parsed)) return { error: 'output must be a JSON object' };

  const decision = parsed.decision;
  if (decision !== undefined && decision !== 'allow' && decision !== 'deny') {
    // Strict on purpose: an unrecognised decision must never be interpreted as
    // permission. There is no value here that could loosen anything.
    return { error: `unknown decision ${JSON.stringify(decision)}; expected "allow" or "deny"` };
  }

  return {
    result: {
      ...(decision ? { decision } : {}),
      ...(typeof parsed.reason === 'string' ? { reason: bound(parsed.reason, 600) } : {}),
      ...(typeof parsed.context === 'string' ? { context: bound(parsed.context, 8_000) } : {})
    }
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withStderr(reason: string, stderr: string): string {
  const detail = stderr.trim();
  return detail ? `${reason}: ${detail.slice(-400)}` : reason;
}

function bound(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
