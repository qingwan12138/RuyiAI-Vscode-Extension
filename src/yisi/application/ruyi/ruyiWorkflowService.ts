import { RuyiPort } from '../../ruyi/ruyiPort';
import { YisiTool } from '../../domain/tool';

export interface RuyiWorkflowTarget {
  board?: string;
  profile?: string;
}

export interface RuyiWorkflowPlan {
  available: boolean;
  version?: string;
  note?: string;
  toolchainPackages: string[];
  profiles: string[];
  targetProfile?: string;
  /** True when the target profile is installed. */
  profilePresent?: boolean;
  /** True when an installed toolchain can supply a sysroot for the target. */
  sysrootDerivable: boolean;
  /** True when a toolchain/profile is present so a venv can be created. */
  venvDerivable: boolean;
  gaps: string[];
  summary: string;
}

const MAX_SAMPLES = 16;

/**
 * Ruyi-aware prerequisite planning (v0.6). From `ruyi --porcelain` data only it
 * reports which of Board -> Profile -> Toolchain -> Sysroot -> Venv are already
 * satisfied and what is missing for an optional target board/profile. It never
 * guesses a board -> toolchain mapping (that is fixture/domain data surfaced by
 * the real Ruyi environment); it only flags named gaps and enumerates present
 * toolchains so the higher-level workflow can call ruyi_manage / ruyi_check.
 */
export class RuyiWorkflowService {
  constructor(private readonly ruyi: RuyiPort) {}

  async plan(target: RuyiWorkflowTarget = {}, signal?: AbortSignal): Promise<RuyiWorkflowPlan> {
    let version: string;
    try {
      version = await this.ruyi.getVersion();
    } catch {
      return {
        available: false,
        toolchainPackages: [],
        profiles: [],
        sysrootDerivable: false,
        venvDerivable: false,
        gaps: ['The ruyi CLI is not available. Install RuyiSDK CLI or fix PATH to plan a RISC-V build.'],
        summary: 'Ruyi: unavailable — cannot plan a Ruyi-aware workflow.'
      };
    }

    const [packages, profilesResult] = await Promise.all([
      this.ruyi.listPackages().catch(() => ({ code: -1, stdout: '', stderr: '', records: [] as unknown[] })),
      this.ruyi.listProfiles().catch(() => ({ code: -1, stdout: '', stderr: '', records: [] as unknown[] }))
    ]);
    const toolchainPackages = recordNames(packages.records).slice(0, MAX_SAMPLES);
    const profiles = recordNames(profilesResult.records).slice(0, MAX_SAMPLES);

    const targetProfile = target.profile;
    const toolchainPresent = toolchainPackages.length > 0;
    const profilePresent = targetProfile ? profiles.includes(targetProfile) : profiles.length > 0;

    const gaps: string[] = [];
    if (targetProfile && !profiles.includes(targetProfile)) {
      gaps.push(`profile "${targetProfile}" is not installed (create it, then extract a toolchain)`);
    }
    if (!toolchainPresent) {
      gaps.push('no Ruyi toolchain package is installed (extract one for the target board)');
    }
    if (target.board && !toolchainPresent) {
      gaps.push(`no toolchain for board "${target.board}" — install/extract one`);
    }

    const sysrootDerivable = toolchainPresent;
    const venvDerivable = toolchainPresent && (profilePresent !== false);

    const summaryLines = [`Ruyi CLI: ${version}`];
    summaryLines.push(`Toolchain packages: ${toolchainPackages.length > 0 ? toolchainPackages.join(', ') : 'none'}`);
    summaryLines.push(`Profiles: ${profiles.length > 0 ? profiles.join(', ') : 'none'}`);
    if (target.board) summaryLines.push(`Target board: ${target.board}`);
    if (targetProfile) summaryLines.push(`Target profile: ${targetProfile}${profiles.includes(targetProfile) ? ' (installed)' : ' (missing)'}`);
    summaryLines.push(`Sysroot derivable: ${sysrootDerivable ? 'yes' : 'no'}`);
    summaryLines.push(`Venv derivable: ${venvDerivable ? 'yes' : 'no'}`);
    if (gaps.length > 0) summaryLines.push(`Gaps:\n${gaps.map(gap => `- ${gap}`).join('\n')}`);

    return {
      available: true,
      version,
      toolchainPackages,
      profiles,
      ...(targetProfile !== undefined ? { targetProfile, profilePresent } : {}),
      sysrootDerivable,
      venvDerivable,
      gaps,
      summary: summaryLines.join('\n')
    };
  }
}

export function createRuyiWorkflowTool(service: RuyiWorkflowService): YisiTool {
  return {
    id: 'ruyi_workflow',
    description:
      'Plan a Ruyi-aware RISC-V workflow: report the ruyi CLI, installed toolchain packages and profiles, and whether the requested board/profile toolchain, sysroot and venv are satisfied (read-only). Use it before asking ruyi_manage to install/extract/create anything, so the workflow does not guess a missing toolchain. Takes an optional target board/profile.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', minLength: 1, maxLength: 128 },
        profile: { type: 'string', minLength: 1, maxLength: 128 }
      },
      additionalProperties: false
    },
    execute: async (input, context) => {
      const target = sanitizeTarget(input);
      const plan = await service.plan(target, context.signal);
      return plan;
    }
  };
}

function sanitizeTarget(input: unknown): RuyiWorkflowTarget {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>;
  const target: RuyiWorkflowTarget = {};
  if (typeof value.board === 'string' && value.board.trim()) target.board = value.board.trim();
  if (typeof value.profile === 'string' && value.profile.trim()) target.profile = value.profile.trim();
  return target;
}

function recordNames(records: unknown[]): string[] {
  const names: string[] = [];
  for (const record of records) {
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
  return undefined;
}
