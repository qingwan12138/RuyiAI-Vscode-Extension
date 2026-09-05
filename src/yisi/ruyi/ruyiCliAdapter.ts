import { RuyiCommandResult, RuyiPort } from './ruyiPort';
import { ProcessResult, ProcessRunner } from '../domain/process';
import { NodeProcessRunner } from '../infrastructure/process/nodeProcessRunner';

/**
 * Ruyi CLI adapter backed by the structured ProcessRunner: precise argv,
 * bounded stdout/stderr, timeout and cancellation, no shell. Core operations
 * are expressed through `ruyi --porcelain` and parsed as one JSON document per
 * line; the adapter never parses the human-facing CLI text. The exact porcelain
 * subcommand grammar is centralized here so a future Ruyi version change only
 * touches this adapter.
 */
export class RuyiCliAdapter implements RuyiPort {
  constructor(
    private readonly executable = 'ruyi',
    private readonly runner: ProcessRunner = new NodeProcessRunner(),
    private readonly cwd = process.cwd()
  ) {}

  async getVersion(): Promise<string> {
    const result = await this.execute(['--version']);
    if (result.code !== 0) {
      throw new Error(`ruyi --version failed: ${tail(result.stderr)}`);
    }
    return result.stdout.trim();
  }

  listPackages(): Promise<RuyiCommandResult> {
    return this.execute(['--porcelain', 'list']);
  }

  listProfiles(): Promise<RuyiCommandResult> {
    return this.execute(['--porcelain', 'entity', 'list', '-t', 'profile-v1']);
  }

  installPackage(packageId: string, version?: string): Promise<RuyiCommandResult> {
    const target = version ? `${packageId}@${version}` : packageId;
    return this.execute(['install', target]);
  }

  uninstallPackage(packageId: string): Promise<RuyiCommandResult> {
    return this.execute(['uninstall', packageId]);
  }

  createVenv(name: string, packageId?: string): Promise<RuyiCommandResult> {
    const args = ['--porcelain', 'venv', 'create', name];
    if (packageId) args.push(packageId);
    return this.execute(args);
  }

  removeVenv(name: string): Promise<RuyiCommandResult> {
    return this.execute(['--porcelain', 'venv', 'remove', name]);
  }

  createProfile(name: string, packageId?: string): Promise<RuyiCommandResult> {
    const args = ['--porcelain', 'entity', 'create', '-t', 'profile-v1', name];
    if (packageId) args.push('--package', packageId);
    return this.execute(args);
  }

  removeProfile(name: string): Promise<RuyiCommandResult> {
    return this.execute(['--porcelain', 'entity', 'remove', '-t', 'profile-v1', name]);
  }

  update(): Promise<RuyiCommandResult> {
    return this.execute(['--porcelain', 'update']);
  }

  extract(packageId: string): Promise<RuyiCommandResult> {
    return this.execute(['--porcelain', 'extract', packageId]);
  }

  private async execute(args: string[], signal?: AbortSignal): Promise<RuyiCommandResult> {
    const result: ProcessResult = await this.runner.run(
      { executable: this.executable, args, cwd: this.cwd },
      signal ?? new AbortController().signal
    );
    if (result.status === 'spawnFailed' || result.status === 'timedOut' || result.status === 'cancelled') {
      throw new Error(`ruyi ${args[0] ?? ''} ${result.status}: ${tail(result.errorMessage ?? '')}`);
    }
    const stdout = result.stdout.text;
    const code = result.exitCode ?? -1;
    const stderrTidied = tail(result.stderr.text);
    return {
      code,
      stdout,
      stderr: result.stderr.text,
      records: code === 0 ? parsePorcelainRecords(stdout) : []
    };
  }
}

/** ruyi `--porcelain` prints one JSON document per line; ignore non-JSON noise. */
export function parsePorcelainRecords(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try {
        const parsed = JSON.parse(line);
        return [parsed];
      } catch {
        return [];
      }
    });
}

function tail(text: string, maxCharacters = 240): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length <= maxCharacters ? normalized : `${normalized.slice(0, maxCharacters - 1)}…`;
}
