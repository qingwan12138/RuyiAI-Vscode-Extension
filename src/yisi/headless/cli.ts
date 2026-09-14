import { HEADLESS_USAGE, HeadlessArgumentError, parseHeadlessArguments } from '../application/agent/headlessPolicy';
import { OpenAICompatibleProvider } from '../infrastructure/llm/openAICompatibleProvider';
import { HeadlessProvider, runHeadlessTask } from './taskRunner';
import { toJsonLine, toolEventToHeadless } from './events';

/**
 * Command-line entry point: one agent task, no editor.
 *
 * It is the same agent the sidebar runs — same tools, same PermissionEngine, same
 * review path — with the approval question answered by the run's policy instead of
 * by a person. That is why the default is **read-only** and why writing has to be
 * asked for explicitly:
 *
 *   yisi-headless --root ./project "summarise how the build works"
 *   yisi-headless --root ./project --allow-write "fix the failing test"
 *
 * Exit codes: 0 the task completed, 1 the task stopped (the reason is printed),
 * 2 the arguments or environment were wrong. The last two are deliberately
 * different so CI can tell "the agent said no" from "you called it wrong".
 */

export interface HeadlessCliEnvironment {
  /** Reads an environment variable; injected so the CLI is testable. */
  env: (name: string) => string | undefined;
  write: (text: string) => void;
  writeError: (text: string) => void;
  /** Overrides provider construction in tests. */
  createProvider?: (options: { baseUrl: string; apiKey?: string; model: string }) => HeadlessProvider;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_API_KEY_ENV = 'YISI_API_KEY';
const DEFAULT_MODEL = 'deepseek-flash';

export async function main(argv: readonly string[], environment: HeadlessCliEnvironment): Promise<number> {
  let args;
  try {
    args = parseHeadlessArguments(argv);
  } catch (error) {
    environment.writeError(`${describe(error)}\n`);
    return 2;
  }

  if (args.help) {
    // Usage is not a failure: it exits 0, and it needs no API key to print.
    environment.write(`${HEADLESS_USAGE}\n`);
    return 0;
  }

  const baseUrl = args.baseUrl ?? environment.env('YISI_BASE_URL') ?? DEFAULT_BASE_URL;
  const apiKey = environment.env(args.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const model = args.model ?? environment.env('YISI_MODEL') ?? DEFAULT_MODEL;
  if (!apiKey && !environment.createProvider) {
    environment.writeError(
      `No API key: set ${args.apiKeyEnv ?? DEFAULT_API_KEY_ENV} in the environment (keys are never passed as arguments).\n`
    );
    return 2;
  }

  const provider =
    environment.createProvider?.({ baseUrl, apiKey, model }) ??
    new OpenAICompatibleProvider({
      id: 'headless',
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      // The agent path needs structured tool calling; without it there is no loop.
      toolCalling: true
    });

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  process.once('SIGINT', onAbort);
  process.once('SIGTERM', onAbort);

  try {
    // `--json` streams NDJSON: one event per line as it happens, with the result
    // last, so a CI job can show progress on a long run and still parse the last
    // line for the outcome.
    const emit = args.json ? (line: string): void => environment.write(line) : undefined;
    const result = await runHeadlessTask({
      root: args.root,
      prompt: args.prompt,
      model,
      policy: args.policy,
      provider,
      onDelta: emit ? text => emit(toJsonLine({ type: 'delta', text })) : text => environment.write(text),
      ...(emit
        ? { onToolEvent: event => emit(toJsonLine(toolEventToHeadless(event))) }
        : {}),
      signal: controller.signal
    });
    if (emit) {
      emit(toJsonLine({
        type: 'result',
        status: result.status,
        text: result.text,
        ...(result.reason ? { reason: result.reason } : {})
      }));
    } else if (result.status === 'completed') {
      environment.write(`\n`);
    }
    if (result.status === 'blocked') {
      environment.writeError(`yisi-headless: stopped: ${result.reason ?? 'unknown reason'}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    environment.writeError(`yisi-headless: ${describe(error)}\n`);
    return 1;
  } finally {
    process.off('SIGINT', onAbort);
    process.off('SIGTERM', onAbort);
  }
}

function describe(error: unknown): string {
  if (error instanceof HeadlessArgumentError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
