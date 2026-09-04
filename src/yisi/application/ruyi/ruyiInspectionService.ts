// Read-only Ruyi environment inspection (A5).
//
// Exposes the local RuyiSDK CLI state (version / installed packages / profiles)
// to the agent as one read-only tool. Availability is probed through the same
// bounded, cancellable command runner the agent already uses; when `ruyi` is
// missing the tool reports that clearly instead of crashing (docs/16 LNX-003/4).

import { YisiTool } from '../../domain/tool';
import { CommandExecutionService } from '../process/commandExecutionService';
import { RuyiPort } from '../../ruyi/ruyiPort';

const RUYI_PROBE_TIMEOUT_MS = 8_000;
const MAX_SAMPLE_NAMES = 8;

export interface RuyiInspection {
  available: boolean;
  version?: string;
  profileCount?: number;
  profileNames: string[];
  packageCount?: number;
  packageNames: string[];
  note?: string;
  summary: string;
}

export class RuyiInspectionService {
  constructor(
    private readonly commands: Pick<CommandExecutionService, 'run'>,
    private readonly ruyi: RuyiPort
  ) {}

  async inspect(signal: AbortSignal): Promise<RuyiInspection> {
    const probe = await this.commands.run(
      { executable: 'ruyi', args: ['--version'], cwd: '.', timeoutMs: RUYI_PROBE_TIMEOUT_MS },
      signal
    );
    if (probe.status !== 'exited' || probe.exitCode !== 0) {
      const note = describeUnavailable(probe);
      return {
        available: false,
        profileNames: [],
        packageNames: [],
        note,
        summary: `Ruyi CLI: unavailable — ${note}`
      };
    }
    const version = probe.stdoutText.trim().split(/\r?\n/)[0] || 'unknown version';

    let packages: string[] = [];
    let packageCount = 0;
    let profiles: string[] = [];
    let profileCount = 0;
    let note: string | undefined;
    try {
      const packageResult = await this.ruyi.listPackages();
      packageCount = packageResult.records.length;
      packages = sampleNames(packageResult.records);
      if (packageResult.code !== 0) note = tail(packageResult.stderr);
    } catch (error) {
      note = `ruyi list failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
    try {
      const profileResult = await this.ruyi.listProfiles();
      profileCount = profileResult.records.length;
      profiles = sampleNames(profileResult.records);
      if (!note && profileResult.code !== 0) note = tail(profileResult.stderr);
    } catch (error) {
      if (!note) note = `ruyi profile list failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    }

    const summaryLines = [`Ruyi CLI: ${version}`];
    summaryLines.push(`Installed packages: ${packageCount}${packages.length > 0 ? ` (${packages.join(', ')})` : ''}`);
    summaryLines.push(`Available profiles: ${profileCount}${profiles.length > 0 ? ` (${profiles.join(', ')})` : ''}`);
    if (note) summaryLines.push(`Note: ${note}`);

    return {
      available: true,
      version,
      profileCount,
      profileNames: profiles,
      packageCount,
      packageNames: packages,
      ...(note !== undefined ? { note } : {}),
      summary: summaryLines.join('\n')
    };
  }
}

export function createRuyiInspectTool(service: RuyiInspectionService): YisiTool {
  return {
    id: 'ruyi_check',
    description:
      'Inspect the local RuyiSDK environment: ruyi CLI version, installed toolchain packages and available '
      + 'profiles (read-only). Use it before assuming a RISC-V toolchain/profile exists, and to confirm what '
      + 'a build command can rely on. When ruyi is not installed it reports that clearly. Takes no input.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_input, context) => {
      const inspection = await service.inspect(context.signal);
      return inspection;
    }
  };
}

function sampleNames(records: unknown[]): string[] {
  const names: string[] = [];
  for (const record of records.slice(0, MAX_SAMPLE_NAMES)) {
    const name = recordName(record);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function recordName(record: unknown): string | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = record as Record<string, unknown>;
  for (const key of ['id', 'name', 'profile', 'package_id', 'package']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 80 ? serialized : `${serialized.slice(0, 79)}…`;
  } catch {
    return undefined;
  }
}

function describeUnavailable(probe: { status: string; exitCode: number | null; stderrText: string; stdoutText: string }): string {
  if (probe.status === 'spawnFailed' || (probe.status === 'exited' && probe.exitCode !== 0)) {
    return 'The `ruyi` command was not found or failed to start. Install RuyiSDK CLI or fix PATH, then retry.';
  }
  const detail = tail(probe.stderrText || probe.stdoutText);
  return detail ? `ruyi probe failed: ${detail}` : 'ruyi probe did not complete successfully.';
}

function tail(text: string, maxCharacters = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxCharacters ? normalized : `${normalized.slice(0, maxCharacters - 1)}…`;
}
