import { spawn, ChildProcess } from 'node:child_process';
import { CapturedOutput, ProcessRequest, ProcessResult, ProcessRunner, ProcessStatus } from '../../domain/process';
import { BoundedOutput } from './boundedOutput';
import { createDefaultProcessTreeController, ProcessTreeController } from './processTreeController';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 1_500;
const MAX_ERROR_MESSAGE_LENGTH = 240;

function validateRequest(request: ProcessRequest): void {
  const positiveInteger = (value: number | undefined): boolean =>
    value === undefined || (Number.isInteger(value) && value > 0);
  const envIsValid = request.env === undefined || (
    typeof request.env === 'object' && request.env !== null &&
    Object.values(request.env).every(value => value === undefined || typeof value === 'string')
  );
  if (
    !request || typeof request.executable !== 'string' || request.executable.length === 0 ||
    !Array.isArray(request.args) || !request.args.every(arg => typeof arg === 'string') ||
    typeof request.cwd !== 'string' || request.cwd.length === 0 ||
    !envIsValid ||
    !positiveInteger(request.timeoutMs) ||
    !positiveInteger(request.outputLimitBytes) ||
    !positiveInteger(request.terminationGraceMs)
  ) {
    throw new Error('Invalid process request.');
  }
}

function mergeEnvironment(overrides: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

function redact(text: string, secrets: readonly string[]): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret.length > 0) safe = safe.split(secret).join('[REDACTED]');
  }
  return safe;
}

function redactCapture(capture: CapturedOutput, secrets: readonly string[]): CapturedOutput {
  return { ...capture, text: redact(capture.text, secrets) };
}

function emptyCapture(): CapturedOutput {
  return { text: '', totalBytes: 0, retainedBytes: 0, truncated: false };
}

function boundedError(error: unknown, secrets: readonly string[]): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redact(raw, secrets).slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export class NodeProcessRunner implements ProcessRunner {
  constructor(private readonly treeController: ProcessTreeController = createDefaultProcessTreeController()) {}

  async run(request: ProcessRequest, signal: AbortSignal): Promise<ProcessResult> {
    validateRequest(request);
    const startedAt = Date.now();
    if (signal.aborted) {
      return {
        status: 'cancelled', exitCode: null, signal: null,
        stdout: emptyCapture(), stderr: emptyCapture(), durationMs: Date.now() - startedAt
      };
    }

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const outputLimitBytes = request.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    const terminationGraceMs = request.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    const stdout = new BoundedOutput(outputLimitBytes);
    const stderr = new BoundedOutput(outputLimitBytes);
    const secrets = Object.values(request.env ?? {}).filter((value): value is string => typeof value === 'string' && value.length > 0);

    return new Promise<ProcessResult>(resolve => {
      let child: ChildProcess;
      let finished = false;
      let requestedStatus: Extract<ProcessStatus, 'cancelled' | 'timedOut'> | undefined;
      let timer: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      const settle = (result: Omit<ProcessResult, 'durationMs'>): void => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({ ...result, durationMs: Date.now() - startedAt });
      };
      const terminate = (status: 'cancelled' | 'timedOut'): void => {
        if (finished || requestedStatus) return;
        requestedStatus = status;
        void this.treeController.terminate(child, terminationGraceMs).catch(error => {
          settle({
            status,
            exitCode: null,
            signal: null,
            stdout: redactCapture(stdout.snapshot(), secrets),
            stderr: redactCapture(stderr.snapshot(), secrets),
            errorMessage: boundedError(error, secrets)
          });
        });
      };
      const onAbort = (): void => terminate('cancelled');

      try {
        child = spawn(request.executable, request.args, {
          cwd: request.cwd,
          env: mergeEnvironment(request.env),
          shell: false,
          detached: this.treeController.detached,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        settle({
          status: 'spawnFailed', exitCode: null, signal: null,
          stdout: emptyCapture(), stderr: emptyCapture(), errorMessage: boundedError(error, secrets)
        });
        return;
      }

      child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk));
      child.once('error', error => {
        const status = requestedStatus ?? 'spawnFailed';
        settle({
          status, exitCode: null, signal: null,
          stdout: redactCapture(stdout.snapshot(), secrets),
          stderr: redactCapture(stderr.snapshot(), secrets),
          errorMessage: boundedError(error, secrets)
        });
      });
      child.once('close', (exitCode, closeSignal) => {
        const status = requestedStatus ?? 'exited';
        settle({
          status,
          exitCode: requestedStatus ? null : exitCode,
          signal: closeSignal,
          stdout: redactCapture(stdout.snapshot(), secrets),
          stderr: redactCapture(stderr.snapshot(), secrets)
        });
      });

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      if (!requestedStatus) timer = setTimeout(() => terminate('timedOut'), timeoutMs);
    });
  }
}
