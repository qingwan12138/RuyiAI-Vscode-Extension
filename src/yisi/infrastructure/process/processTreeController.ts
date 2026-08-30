import { ChildProcess } from 'node:child_process';

export interface ProcessTreeController {
  readonly detached: boolean;
  terminate(child: ChildProcess, graceMs: number): Promise<void>;
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

export function createDefaultProcessTreeController(): ProcessTreeController {
  return new DirectChildProcessController();
}
