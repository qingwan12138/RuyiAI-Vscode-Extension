import { spawn } from 'child_process';
import { RuyiCommandResult, RuyiPort } from './ruyiPort';

export class RuyiCliAdapter implements RuyiPort {
  constructor(private readonly executable = 'ruyi') {}

  async getVersion(): Promise<string> {
    const result = await this.run(['--version']);
    return result.stdout.trim();
  }

  listPackages(): Promise<RuyiCommandResult> {
    return this.run(['--porcelain', 'list']);
  }

  listProfiles(): Promise<RuyiCommandResult> {
    return this.run(['--porcelain', 'entity', 'list', '-t', 'profile-v1']);
  }

  installPackage(packageId: string, version?: string): Promise<RuyiCommandResult> {
    const target = version ? `${packageId}@${version}` : packageId;
    return this.run(['install', target]);
  }

  uninstallPackage(packageId: string): Promise<RuyiCommandResult> {
    return this.run(['uninstall', packageId]);
  }

  private run(args: string[]): Promise<RuyiCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', (code: number | null) => {
        const records = stdout.split(/\r?\n/).filter(Boolean).flatMap(line => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
        resolve({ code: code ?? -1, stdout, stderr, records });
      });
    });
  }
}
