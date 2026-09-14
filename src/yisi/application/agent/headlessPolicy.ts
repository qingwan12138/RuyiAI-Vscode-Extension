import { PermissionMode } from '../../domain/session';
import { ToolRisk } from '../../domain/tool';
import { ToolConfirmationDecision, ToolConfirmationPort, ToolConfirmationRequest } from './readOnlyAgentLoop';

/**
 * Approval policy for a run with no human at the keyboard.
 *
 * This is the CI/headless equivalent of "which mode is this run in", and the
 * decision it encodes is deliberately the conservative one:
 *
 *  - **The default is `plan`.** A headless run that nobody is watching starts
 *    read-only: it can inspect, search, run analyses and report, and every
 *    state-changing action is refused by the engine. Nothing has to be trusted
 *    for the safe case to be the default case.
 *  - **Writes require an explicit opt-in.** `--allow-write` (or the programmatic
 *    equivalent) installs an approver that answers *yes* to the risk classes the
 *    caller named. That is a `--yes` switch by another name, and it is never
 *    reached by default.
 *  - **Two classes stay refused even then.** `destructive` and
 *    `credentialSensitive` map to *no channel available* — the same fail-closed
 *    behaviour as an interactive run whose approval port is missing. A CI flag
 *    must not be able to authorise what a human cannot be asked about.
 *
 * The approver never decides anything itself: every call still goes through
 * PermissionEngine, and this port only answers the questions the engine asks.
 */

/** Risks a headless run may be allowed to auto-approve. */
export const HEADLESS_ALLOWABLE_RISKS: readonly ToolRisk[] = [
  'workspaceWrite',
  'processExec',
  'environmentChange'
];

/** Risks that stay refused in every headless configuration. */
export const HEADLESS_REFUSED_RISKS: readonly ToolRisk[] = ['destructive', 'credentialSensitive'];

export interface HeadlessPolicyOptions {
  /** Explicit mode. `plan` (the default) refuses every state-changing action. */
  mode?: PermissionMode;
  /** Risk classes the caller explicitly allows without a human. */
  allow?: readonly ToolRisk[];
}

export interface HeadlessPolicy {
  mode: PermissionMode;
  /** Present only when the caller opted in to something. */
  confirmations?: ToolConfirmationPort;
  /** What the caller opted in to, for logging and for the run report. */
  allowed: readonly ToolRisk[];
  /** Always refused, whatever the caller asked for. */
  refused: readonly ToolRisk[];
}

export class HeadlessPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeadlessPolicyError';
  }
}

export function resolveHeadlessPolicy(options: HeadlessPolicyOptions = {}): HeadlessPolicy {
  const requested = options.allow ?? [];
  for (const risk of requested) {
    if (!HEADLESS_ALLOWABLE_RISKS.includes(risk)) {
      throw new HeadlessPolicyError(
        `"${risk}" cannot be allowed without a human: headless runs may auto-approve only ${HEADLESS_ALLOWABLE_RISKS.join(', ')}.`
      );
    }
  }
  const mode = options.mode ?? (requested.length ? 'manual' : 'plan');
  if (mode === 'plan' && requested.length) {
    // Plan denies everything state-changing, so an allow list would be dead
    // configuration — and silently ignoring it would be worse than saying so.
    throw new HeadlessPolicyError('Plan mode refuses every state-changing action, so it cannot be combined with --allow-write.');
  }
  const allowed = [...new Set(requested)];
  return {
    mode,
    allowed,
    refused: HEADLESS_REFUSED_RISKS,
    ...(allowed.length ? { confirmations: createAllowListApprover(allowed) } : {})
  };
}

/**
 * Answers for exactly the risk classes the caller named.
 *
 * The engine asks this port only about actions it would otherwise stop for, and
 * the answer is derived from the **risk class on the request** — never from the
 * tool id or the wording. An unlisted class (in practice `destructive` or
 * `credentialSensitive`) has **no channel**: the port throws, which the loop
 * already maps to a fail-closed `unavailable` refusal. Reporting "the user said
 * no" would be a lie about a run with no user in it.
 */
function createAllowListApprover(allowed: readonly ToolRisk[]): ToolConfirmationPort {
  return {
    async confirm(request: ToolConfirmationRequest): Promise<boolean | ToolConfirmationDecision> {
      if (!allowed.includes(request.risk)) {
        throw new Error(
          `No approval channel for a "${request.risk}" action in a headless run (allowed: ${allowed.join(', ')}).`
        );
      }
      return true;
    }
  };
}

/**
 * Parses the CLI's `--mode` / `--allow-write` flags into policy options.
 * Kept pure so the argument contract is testable without a process.
 */
export interface HeadlessArguments {
  prompt: string;
  root: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  policy: HeadlessPolicy;
  json: boolean;
  /** The caller asked for usage instead of a run. */
  help: boolean;
}

/** Printed for `--help`. Kept next to the parser so the two cannot drift apart. */
export const HEADLESS_USAGE = [
  'yisi-headless — run one Yisi AI task without an editor',
  '',
  'Usage: yisi-headless [options] "what to do"',
  '',
  'Options:',
  '  --root <dir>        Workspace to run in (default: the current directory)',
  '  --model <id>        Model id (default: $YISI_MODEL, then deepseek-flash)',
  '  --base-url <url>    OpenAI-compatible endpoint (default: $YISI_BASE_URL, then api.deepseek.com/v1)',
  '  --api-key-env <var> Environment variable holding the key (default: YISI_API_KEY)',
  '  --mode <mode>       plan | manual | acceptEdits | auto | fullAccess (default: plan)',
  '  --allow-write       Opt in to workspace writes and commands (implies --mode manual)',
  '  --json              Stream NDJSON events, with the result as the last line',
  '  --help              Show this text',
  '',
  'Without --allow-write the run is READ-ONLY: every state-changing action is refused.',
  'destructive and credential-sensitive actions are never auto-approved.',
  'Keys are read from the environment only — never passed as arguments.',
  '',
  'Exit codes: 0 completed, 1 stopped, 2 bad arguments or configuration'
].join('\n');

export class HeadlessArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeadlessArgumentError';
  }
}

const MODES: readonly PermissionMode[] = ['plan', 'manual', 'acceptEdits', 'auto', 'fullAccess'];

/**
 * Flags that take no value. They must be listed, otherwise the lookahead below
 * would swallow the prompt as if it were the flag's argument — which is exactly
 * the bug that made `--json "do it"` fail with "a prompt is required".
 */
const BOOLEAN_FLAGS = new Set(['--json', '--allow-write', '--yes', '--help']);

export function parseHeadlessArguments(argv: readonly string[]): HeadlessArguments {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      rest.push(token);
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      flags.set(token, true);
      continue;
    }
    const [name, inline] = token.includes('=') ? token.split(/=(.*)/s, 2) : [token, undefined];
    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }

  const prompt = rest.join(' ').trim();
  const help = flags.has('--help');
  // `--help` must not be answered with "a prompt is required": that is exactly the
  // hostile reply that makes people give up on a CLI.
  if (!prompt && !help) {
    throw new HeadlessArgumentError('A prompt is required: yisi-headless [options] "what to do" (see --help)');
  }

  const root = readFlag(flags, '--root') ?? process.cwd();
  const modeFlag = readFlag(flags, '--mode');
  if (modeFlag !== undefined && !MODES.includes(modeFlag as PermissionMode)) {
    throw new HeadlessArgumentError(`--mode must be one of ${MODES.join(', ')}.`);
  }
  const allowWrite = flags.has('--allow-write') || flags.has('--yes');
  const policy = resolveHeadlessPolicy({
    ...(modeFlag !== undefined ? { mode: modeFlag as PermissionMode } : {}),
    ...(allowWrite ? { allow: ['workspaceWrite', 'processExec', 'environmentChange'] } : {})
  });

  return {
    prompt,
    root,
    ...(readFlag(flags, '--model') !== undefined ? { model: readFlag(flags, '--model') as string } : {}),
    ...(readFlag(flags, '--base-url') !== undefined ? { baseUrl: readFlag(flags, '--base-url') as string } : {}),
    ...(readFlag(flags, '--api-key-env') !== undefined ? { apiKeyEnv: readFlag(flags, '--api-key-env') as string } : {}),
    policy,
    json: flags.has('--json'),
    help
  };
}

function readFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}
