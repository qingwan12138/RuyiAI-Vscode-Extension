// Command execution service + agent tool factory.
//
// The agent may run machine-checkable build/test/lint/analysis commands inside
// the active workspace through a structured (shell:false) ProcessRunner. The
// permission engine still classifies every call (risk processExec): plan
// denies, manual/acceptEdits/auto require explicit confirmation, full access
// allows it without routine approval. On top of that gate this layer applies a
// small conservative guard that always refuses privilege/system/package-manager
// executables, and confines the working directory to the workspace root.
//
// Destructive commands (rm -rf style) intentionally stay classified by the
// permission layer for now; deeper command-risk classification is tracked as a
// later milestone (docs/22 G2) and must not be replaced by brittle string
// matching here.

import * as path from 'node:path';
import { ProcessResult, ProcessRunner } from '../../domain/process';
import { YisiTool } from '../../domain/tool';

const MAX_EXECUTABLE_CHARACTERS = 128;
const MAX_ARGUMENT_CHARACTERS = 4_096;
const MAX_ARGUMENT_COUNT = 256;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_WORKSPACE_PATH_CHARACTERS = 4_096;

/** Privilege / system-mutation executables never run through the agent tool. */
const DENIED_EXECUTABLES: ReadonlySet<string> = new Set([
  'sudo', 'su', 'pkexec', 'doas', 'runuser',
  'systemctl', 'shutdown', 'reboot', 'poweroff', 'halt',
  'apt', 'apt-get', 'dpkg', 'dnf', 'yum', 'zypper', 'pacman', 'snap', 'flatpak'
]);

export interface CommandRunResult {
  command: { executable: string; args: string[]; cwd: string };
  status: ProcessResult['status'];
  exitCode: number | null;
  durationMs: number;
  stdoutText: string;
  stdoutTruncated: boolean;
  stderrText: string;
  stderrTruncated: boolean;
  errorMessage?: string;
}

export class CommandExecutionInputError extends Error {
  constructor(message = 'Invalid command execution input.') {
    super(message);
    this.name = 'CommandExecutionInputError';
  }
}

export class CommandExecutionDeniedError extends Error {
  constructor() {
    super('This executable is not allowed by the agent command policy (privilege/system/package operations).');
    this.name = 'CommandExecutionDeniedError';
  }
}

export class CommandExecutionService {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly workspaceRoot: string
  ) {}

  async run(input: unknown, signal: AbortSignal): Promise<CommandRunResult> {
    const request = parseCommandInput(input, this.workspaceRoot);
    const result = await this.runner.run(
      {
        executable: request.executable,
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs
      },
      signal
    );
    return {
      command: {
        executable: request.executable,
        args: request.args,
        cwd: request.cwd
      },
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutText: result.stdout.text,
      stdoutTruncated: result.stdout.truncated,
      stderrText: result.stderr.text,
      stderrTruncated: result.stderr.truncated,
      ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {})
    };
  }
}

export function createRunCommandTool(service: CommandExecutionService): YisiTool {
  return {
    id: 'run_command',
    description:
      'Run one build/test/lint/analysis command inside the active workspace with a structured argv (no shell). '
      + 'Examples: cmake --build build, ctest --test-dir build, make, gcc -fsyntax-only file.c, npm test, mvn -q test, python -m pytest. '
      + 'Use the smallest command that answers the question; read output and iterate. '
      + 'Not for interactive programs, servers, or package/system operations.',
    risk: 'processExec',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        executable: { type: 'string', minLength: 1, maxLength: MAX_EXECUTABLE_CHARACTERS },
        args: {
          type: 'array',
          items: { type: 'string', minLength: 0, maxLength: MAX_ARGUMENT_CHARACTERS },
          maxItems: MAX_ARGUMENT_COUNT
        },
        cwd: { type: 'string', minLength: 1, maxLength: MAX_WORKSPACE_PATH_CHARACTERS },
        timeoutMs: { type: 'integer', minimum: 1, maximum: MAX_TIMEOUT_MS }
      },
      required: ['executable'],
      additionalProperties: false
    },
    execute: (input, context) => service.run(input, context.signal)
  };
}

export interface ParsedCommandRequest {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}

export function parseCommandInput(value: unknown, workspaceRoot: string): ParsedCommandRequest {
  if (!isRecord(value)) throw new CommandExecutionInputError();
  const allowedKeys = new Set(['executable', 'args', 'cwd', 'timeoutMs']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new CommandExecutionInputError();
  }
  const executable = normalizeExecutable(value.executable);
  const args = parseArguments(value.args);
  const cwd = parseCwd(value.cwd, workspaceRoot);
  const timeoutMs = value.timeoutMs === undefined
    ? undefined
    : parseTimeoutMs(value.timeoutMs);
  return { executable, args, cwd, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

function normalizeExecutable(value: unknown): string {
  if (typeof value !== 'string') throw new CommandExecutionInputError();
  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.length > MAX_EXECUTABLE_CHARACTERS
    || trimmed.includes('\0')
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.startsWith('.')
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(trimmed)
  ) {
    throw new CommandExecutionInputError('The executable must be a plain PATH command name.');
  }
  const basename = trimmed.toLowerCase();
  if (DENIED_EXECUTABLES.has(basename)) {
    throw new CommandExecutionDeniedError();
  }
  return trimmed;
}

function parseArguments(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARGUMENT_COUNT) {
    throw new CommandExecutionInputError();
  }
  return value.map(argument => {
    if (typeof argument !== 'string' || argument.length > MAX_ARGUMENT_CHARACTERS || argument.includes('\0')) {
      throw new CommandExecutionInputError();
    }
    return argument;
  });
}

function parseCwd(value: unknown, workspaceRoot: string): string {
  const relative = value === undefined ? '.' : value;
  if (typeof relative !== 'string' || !relative.trim() || relative.includes('\0')) {
    throw new CommandExecutionInputError();
  }
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relative.trim());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new CommandExecutionInputError('Command working directory must stay inside the workspace.');
  }
  return resolved;
}

function parseTimeoutMs(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_TIMEOUT_MS) {
    throw new CommandExecutionInputError();
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
