export interface ProcessRequest {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}
export interface ProcessResult { exitCode: number | null; stdout: string; stderr: string; cancelled: boolean; }
export interface ProcessRunner { run(request: ProcessRequest, signal: AbortSignal): Promise<ProcessResult>; }
