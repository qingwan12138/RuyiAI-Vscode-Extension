// ValidationPlanner (A3): pick and run project validation commands.
//
// After the agent creates/edits test or doc files it should verify the change.
// This service turns the detector's suggested commands into structured runs
// through the same permissioned command executor the agent already has, then
// returns bounded evidence the model can read to iterate or to claim success.
// It never guesses arbitrary commands and never runs privileged operations.

import { YisiTool } from '../../domain/tool';
import { CommandRunResult, CommandExecutionService } from '../process/commandExecutionService';
import { ProjectProfileInspection, ProjectProfileService } from '../context/projectProfileService';
import { chooseValidationHints, parseCommandHint, PlannedRun } from './commandPlan';

export interface ValidationRunEvidence {
  command: { executable: string; args: string[] };
  status: CommandRunResult['status'];
  exitCode: number | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  passed: boolean;
}

export interface ValidationReport {
  profile: { languages: string[]; testFrameworks: string[] };
  runs: ValidationRunEvidence[];
  skipped: string[];
  passed: boolean;
}

const OUTPUT_TAIL_CHARACTERS = 1_500;
const MAX_SKIPPED_NOTES = 4;
const MAX_PLANNED_RUNS = 3;

export class ValidationPlannerService {
  constructor(
    private readonly commands: Pick<CommandExecutionService, 'run'>,
    private readonly profiles: Pick<ProjectProfileService, 'inspect'>
  ) {}

  async validate(signal: AbortSignal): Promise<ValidationReport> {
    const inspection: ProjectProfileInspection = await this.profiles.inspect(signal);
    const profile = inspection.profile;
    const chosen = chooseValidationHints(profile.testCommandHints, []);

    const skipped: string[] = [];
    const runs: ValidationRunEvidence[] = [];
    let passed = true;
    const executed = new Set<string>();

    for (const hint of chosen) {
      signal.throwIfAborted();
      if (runs.length >= MAX_PLANNED_RUNS) break;
      if (executed.has(hint)) continue;
      executed.add(hint);
      const planned = parseCommandHint(hint);
      if (planned.unsupported) {
        skipped.push(`${hint} — ${planned.unsupported}`);
        if (skipped.length >= MAX_SKIPPED_NOTES) break;
        continue;
      }
      if (planned.runs.length === 0) continue;
      for (const run of planned.runs.slice(0, 2)) {
        signal.throwIfAborted();
        if (runs.length >= MAX_PLANNED_RUNS) break;
        runs.push(await this.executeRun(run, signal));
        if (runs.at(-1)!.status === 'cancelled' || runs.at(-1)!.status === 'timedOut') break;
      }
    }
    for (const run of runs) {
      if (!run.passed) passed = false;
    }
    return {
      profile: {
        languages: profile.languages,
        testFrameworks: profile.testFrameworks.map(item => item.kind)
      },
      runs,
      skipped,
      passed
    };
  }

  private async executeRun(run: PlannedRun, signal: AbortSignal): Promise<ValidationRunEvidence> {
    const result = await this.commands.run({ executable: run.executable, args: run.args, cwd: '.' }, signal);
    const passed = result.status === 'exited' && result.exitCode === 0;
    return {
      command: { executable: run.executable, args: run.args },
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutTail: tail(result.stdoutText, OUTPUT_TAIL_CHARACTERS),
      stderrTail: tail(result.stderrText, OUTPUT_TAIL_CHARACTERS),
      passed
    };
  }
}

function tail(text: string, maxCharacters: number): string {
  return text.length <= maxCharacters ? text : `…${text.slice(text.length - maxCharacters)}`;
}

export function createRunValidationsTool(planner: ValidationPlannerService): YisiTool {
  return {
    id: 'run_validations',
    description:
      'Detect the project test/build setup (inspect_project) and run the suggested verification commands '
      + '(e.g. ctest, cmake --build, mvn test, npm test) sequentially, returning bounded output and a pass/fail '
      + 'verdict. Call this after creating or editing test/doc files before claiming success. '
      + 'Permission-gated like run_command.',
    risk: 'processExec',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_input, context) => planner.validate(context.signal)
  };
}
