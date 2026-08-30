import { ChildProcess } from 'node:child_process';

export interface ProcessTreeController {
  readonly detached: boolean;
  terminate(child: ChildProcess, graceMs: number): Promise<void>;
}

export interface LinuxProcessHost {
  kill(pid: number, signal: NodeJS.Signals): unknown;
  delay(ms: number): Promise<void>;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExitOrDelay(child: ChildProcess, delayMs: number): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise(resolve => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (timer) clearTimeout(timer);
      child.off('exit', finish);
      resolve();
    };
    child.once('exit', finish);
    timer = setTimeout(finish, delayMs);
  });
}

export class DirectChildProcessController implements ProcessTreeController {
  readonly detached = false;

  async terminate(child: ChildProcess, graceMs: number): Promise<void> {
    if (hasExited(child)) return;
    child.kill('SIGTERM');
    await waitForExitOrDelay(child, graceMs);
    if (!hasExited(child)) child.kill('SIGKILL');
  }
}

const defaultLinuxHost: LinuxProcessHost = {
  kill: (pid, signal) => process.kill(pid, signal),
  delay: ms => new Promise(resolve => setTimeout(resolve, ms))
};

function isMissingProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

export class LinuxProcessTreeController implements ProcessTreeController {
  readonly detached = true;

  constructor(private readonly host: LinuxProcessHost = defaultLinuxHost) {}

  async terminate(child: ChildProcess, graceMs: number): Promise<void> {
    if (!child.pid || hasExited(child)) return;
    const processGroupId = -child.pid;
    if (!this.signalGroup(processGroupId, 'SIGTERM')) return;
    await this.waitForExitOrGrace(child, graceMs);
    if (!hasExited(child)) this.signalGroup(processGroupId, 'SIGKILL');
  }

  private signalGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
    try {
      this.host.kill(processGroupId, signal);
      return true;
    } catch (error) {
      if (isMissingProcess(error)) return false;
      throw error;
    }
  }

  private async waitForExitOrGrace(child: ChildProcess, graceMs: number): Promise<void> {
    if (hasExited(child)) return;
    let onExit: (() => void) | undefined;
    const exited = new Promise<void>(resolve => {
      onExit = resolve;
      child.once('exit', resolve);
    });
    try {
      await Promise.race([exited, this.host.delay(graceMs)]);
    } finally {
      if (onExit) child.off('exit', onExit);
    }
  }
}

export function createProcessTreeController(platform: NodeJS.Platform): ProcessTreeController {
  return platform === 'linux'
    ? new LinuxProcessTreeController()
    : new DirectChildProcessController();
}

export function createDefaultProcessTreeController(): ProcessTreeController {
  return createProcessTreeController(process.platform);
}
