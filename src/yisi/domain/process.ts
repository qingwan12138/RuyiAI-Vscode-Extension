export type ProcessStatus = 'exited' | 'cancelled' | 'timedOut' | 'spawnFailed';

export interface ProcessRequest {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  outputLimitBytes?: number;
  terminationGraceMs?: number;
}

export interface CapturedOutput {
  text: string;
  totalBytes: number;
  retainedBytes: number;
  truncated: boolean;
}

export interface ProcessResult {
  status: ProcessStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: CapturedOutput;
  stderr: CapturedOutput;
  durationMs: number;
  errorMessage?: string;
}

export interface ProcessRunner {
  run(request: ProcessRequest, signal: AbortSignal): Promise<ProcessResult>;
}
