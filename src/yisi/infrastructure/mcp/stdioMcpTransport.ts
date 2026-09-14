import { ChildProcess, spawn } from 'node:child_process';
import { McpTransport, McpTransportEvents } from '../../domain/mcpPort';
import { createDefaultProcessTreeController, ProcessTreeController } from '../process/processTreeController';

/**
 * MCP over a child process's stdio: newline-delimited JSON-RPC, one message per
 * line, which is what the MCP stdio transport specifies.
 *
 * Follows the same process rules as the command runner (docs/16):
 *  - `shell: false` with an exact argv, so a configured command cannot smuggle
 *    shell syntax;
 *  - on Linux the child becomes a process-group leader so shutdown kills the
 *    whole tree, not just the direct child (a server started through a wrapper
 *    must not leave orphans behind, LNX-013);
 *  - stderr is captured with a bound and shown in the failure reason, because a
 *    server that dies on startup usually explains itself there.
 */

export interface StdioMcpTransportOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Grace between SIGTERM and SIGKILL on close. */
  graceMs?: number;
  maxLineCharacters?: number;
  maxStderrCharacters?: number;
  treeController?: ProcessTreeController;
}

const DEFAULT_GRACE_MS = 2_000;
const DEFAULT_MAX_LINE_CHARACTERS = 4_000_000;
const DEFAULT_MAX_STDERR_CHARACTERS = 4_000;

export class StdioMcpTransport implements McpTransport {
  private child?: ChildProcess;
  private events?: McpTransportEvents;
  private buffer = '';
  private stderr = '';
  private closing = false;

  constructor(private readonly options: StdioMcpTransportOptions) {}

  async start(events: McpTransportEvents): Promise<void> {
    if (this.child) throw new Error('The MCP transport has already been started.');
    this.events = events;
    const tree = this.options.treeController ?? createDefaultProcessTreeController();
    const child = spawn(this.options.command, [...(this.options.args ?? [])], {
      shell: false,
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      ...(this.options.env ? { env: this.options.env } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: tree.detached
    });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(chunk));
    child.stderr?.on('data', (chunk: string) => {
      const limit = this.options.maxStderrCharacters ?? DEFAULT_MAX_STDERR_CHARACTERS;
      this.stderr = `${this.stderr}${chunk}`.slice(-limit);
    });
    child.on('error', error => {
      if (this.closing) return;
      this.events?.onError(error instanceof Error ? error : new Error(String(error)));
    });
    child.on('exit', (code, signal) => {
      this.flushRemainder();
      if (this.closing) return;
      this.events?.onClose(describeExit(code, signal, this.stderr));
    });
    // `spawn` reports a missing executable asynchronously; surface it as a
    // startup failure rather than letting the first request time out.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  async send(message: unknown): Promise<void> {
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw new Error('The MCP transport is not connected.');
    }
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      child.stdin?.write(line, error => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // The pipe may already be gone; the terminate path below still applies.
    }
    const tree = this.options.treeController ?? createDefaultProcessTreeController();
    await tree.terminate(child, this.options.graceMs ?? DEFAULT_GRACE_MS);
  }

  /** Splits the stdout stream into newline-delimited messages. */
  private consume(chunk: string): void {
    this.buffer += chunk;
    const limit = this.options.maxLineCharacters ?? DEFAULT_MAX_LINE_CHARACTERS;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.deliver(line);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > limit) {
      // A server that never emits a newline must not grow the buffer forever.
      this.buffer = '';
      this.events?.onError(new Error('The MCP server sent a line larger than the client limit.'));
    }
  }

  private deliver(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Non-JSON output on stdout is a protocol violation; reporting it beats
      // silently dropping whatever the server was trying to say.
      this.events?.onError(new Error('The MCP server sent a line that is not JSON.'));
      return;
    }
    this.events?.onMessage(parsed);
  }

  private flushRemainder(): void {
    const line = this.buffer.trim();
    this.buffer = '';
    if (line) this.deliver(line);
  }
}

function describeExit(code: number | null, signal: NodeJS.Signals | null, stderr: string): string {
  const status = signal ? `signal ${signal}` : `code ${code}`;
  const detail = stderr.trim();
  const suffix = detail ? `: ${detail.slice(-600)}` : '';
  return `The MCP server exited (${status})${suffix}`;
}
