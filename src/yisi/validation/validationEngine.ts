import { CapturedOutput, ProcessRequest, ProcessRunner, ProcessStatus } from '../domain/process';
import { DiagnosticProvider, DiagnosticSnapshot } from '../domain/diagnostics';

export type ValidationKind = 'build' | 'test' | 'lint' | 'typecheck' | 'ruyi';

export interface CommandValidationStep {
  kind: ValidationKind;
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  outputLimitBytes?: number;
  terminationGraceMs?: number;
}

export interface DiagnosticValidationStep {
  kind: 'diagnostics';
}

export type ValidationStep = CommandValidationStep | DiagnosticValidationStep;

export type ValidationReason = 'completed' | 'failed' | 'cancelled' | 'timedOut' | 'noEvidence';

export interface CommandValidationStepEvidence {
  step: Omit<CommandValidationStep, 'env'>;
  passed: boolean;
  status: ProcessStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: CapturedOutput;
  stderr: CapturedOutput;
  summary: string;
}

export interface DiagnosticValidationStepEvidence {
  step: DiagnosticValidationStep;
  passed: boolean;
  status: 'completed' | 'unavailable';
  snapshot: DiagnosticSnapshot;
  summary: string;
}

export type ValidationStepEvidence = CommandValidationStepEvidence | DiagnosticValidationStepEvidence;

export interface ValidationResult {
  passed: boolean;
  reason: ValidationReason;
  steps: ValidationStepEvidence[];
}

const VALIDATION_KINDS = new Set<ValidationKind>(['build', 'test', 'lint', 'typecheck', 'ruyi']);

function isPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) > 0);
}

function assertValidStep(step: ValidationStep): void {
  const candidate = step as unknown as Record<string, unknown>;
  if (candidate.kind === 'diagnostics') {
    if (Object.keys(candidate).length !== 1) throw new Error('Invalid validation step.');
    return;
  }
  const args = candidate.args;
  const env = candidate.env;
  const envIsValid = env === undefined || (
    typeof env === 'object' && env !== null && !Array.isArray(env) &&
    Object.values(env).every(value => value === undefined || typeof value === 'string')
  );
  if (
    typeof candidate.kind !== 'string' || !VALIDATION_KINDS.has(candidate.kind as ValidationKind) ||
    typeof candidate.executable !== 'string' || candidate.executable.length === 0 ||
    !Array.isArray(args) || !args.every(arg => typeof arg === 'string') ||
    typeof candidate.cwd !== 'string' || candidate.cwd.length === 0 ||
    !envIsValid ||
    !isPositiveInteger(candidate.timeoutMs) ||
    !isPositiveInteger(candidate.outputLimitBytes) ||
    !isPositiveInteger(candidate.terminationGraceMs)
  ) {
    throw new Error('Invalid validation step.');
  }
}

function withoutEnvironment(step: CommandValidationStep): Omit<CommandValidationStep, 'env'> {
  return {
    kind: step.kind,
    executable: step.executable,
    args: [...step.args],
    cwd: step.cwd,
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(step.outputLimitBytes === undefined ? {} : { outputLimitBytes: step.outputLimitBytes }),
    ...(step.terminationGraceMs === undefined ? {} : { terminationGraceMs: step.terminationGraceMs })
  };
}

function summarize(kind: ValidationKind, status: ProcessStatus, exitCode: number | null): string {
  if (status === 'cancelled') return `${kind} cancelled.`;
  if (status === 'timedOut') return `${kind} timed out.`;
  if (status === 'spawnFailed') return `${kind} could not start.`;
  if (exitCode === 0) return `${kind} passed (exit 0).`;
  return `${kind} failed (exit ${exitCode ?? 'unknown'}).`;
}

function reasonFor(status: ProcessStatus): Exclude<ValidationReason, 'completed' | 'noEvidence'> {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'timedOut') return 'timedOut';
  return 'failed';
}

function unavailableDiagnosticSnapshot(): DiagnosticSnapshot {
  return {
    available: false,
    items: [],
    total: 0,
    truncated: false,
    counts: { error: 0, warning: 0, information: 0, hint: 0 }
  };
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function summarizeDiagnostics(snapshot: DiagnosticSnapshot): string {
  if (!snapshot.available) return 'diagnostics unavailable.';
  const counts = `${countLabel(snapshot.counts.error, 'error')}, ${countLabel(snapshot.counts.warning, 'warning')}`;
  const truncated = snapshot.truncated ? '; retained items truncated' : '';
  return snapshot.counts.error === 0
    ? `diagnostics passed (${counts}${truncated}).`
    : `diagnostics failed (${counts}${truncated}).`;
}

export class ValidationEngine {
  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly diagnosticProvider?: DiagnosticProvider
  ) {}

  async validate(steps: ValidationStep[], signal: AbortSignal): Promise<ValidationResult> {
    for (const step of steps) assertValidStep(step);
    if (steps.length === 0) return { passed: false, reason: 'noEvidence', steps: [] };

    const evidence: ValidationStepEvidence[] = [];
    for (const step of steps) {
      if (step.kind === 'diagnostics') {
        const snapshot = this.diagnosticProvider
          ? await this.diagnosticProvider.read(signal)
          : unavailableDiagnosticSnapshot();
        const available = snapshot.available;
        const passed = available && snapshot.counts.error === 0;
        evidence.push({
          step: { kind: 'diagnostics' },
          passed,
          status: available ? 'completed' : 'unavailable',
          snapshot,
          summary: summarizeDiagnostics(snapshot)
        });
        if (!passed) {
          return { passed: false, reason: available ? 'failed' : 'noEvidence', steps: evidence };
        }
        continue;
      }
      const request: ProcessRequest = {
        executable: step.executable,
        args: [...step.args],
        cwd: step.cwd,
        ...(step.env === undefined ? {} : { env: { ...step.env } }),
        ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
        ...(step.outputLimitBytes === undefined ? {} : { outputLimitBytes: step.outputLimitBytes }),
        ...(step.terminationGraceMs === undefined ? {} : { terminationGraceMs: step.terminationGraceMs })
      };
      const result = await this.processRunner.run(request, signal);
      const passed = result.status === 'exited' && result.exitCode === 0;
      evidence.push({
        step: withoutEnvironment(step),
        passed,
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        summary: summarize(step.kind, result.status, result.exitCode)
      });
      if (!passed) return { passed: false, reason: reasonFor(result.status), steps: evidence };
    }
    return { passed: true, reason: 'completed', steps: evidence };
  }
}
