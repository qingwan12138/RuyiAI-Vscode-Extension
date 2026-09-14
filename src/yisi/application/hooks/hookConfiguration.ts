import { HookEvent, HookFailurePolicy } from '../../domain/hookPort';

/**
 * Parses the `yisiAI.hooks` setting.
 *
 * Hooks are user-authored automation that may **block** agent actions, so the
 * configuration is treated as untrusted input: an entry is either fully valid or
 * rejected with a reason the caller logs. Guessing at a half-written hook would
 * silently change whether an action is allowed.
 *
 * Kept free of `vscode` imports so it can be unit-tested directly.
 */

export interface ConfiguredHook {
  event: HookEvent;
  /** Executable, spawned with `shell: false`. Never a shell command line. */
  command: string;
  args: readonly string[];
  /** Tool-id glob; `*` matches anything. Defaults to every tool. */
  match: string;
  timeoutMs: number;
  /** What to do when the hook cannot run. Defaults to `block` for pre-tool hooks. */
  onError: HookFailurePolicy;
}

export interface RejectedHook {
  index: number;
  reason: string;
}

export interface HookConfigurationParseResult {
  hooks: ConfiguredHook[];
  rejected: RejectedHook[];
}

const EVENTS: readonly HookEvent[] = ['preToolUse', 'postToolUse'];
const MAX_COMMAND = 1_024;
const MAX_ARGUMENT = 4_096;
const MAX_ARGUMENTS = 32;
const MAX_MATCH = 256;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;

export function parseHookConfigurations(value: unknown): HookConfigurationParseResult {
  if (value === undefined || value === null) return { hooks: [], rejected: [] };
  if (!Array.isArray(value)) {
    return { hooks: [], rejected: [{ index: -1, reason: 'The value must be an array of hook objects.' }] };
  }
  const hooks: ConfiguredHook[] = [];
  const rejected: RejectedHook[] = [];
  value.forEach((entry, index) => {
    const parsed = parseOne(entry);
    if ('reason' in parsed) rejected.push({ index, reason: parsed.reason });
    else hooks.push(parsed);
  });
  return { hooks, rejected };
}

function parseOne(entry: unknown): ConfiguredHook | { reason: string } {
  if (!isRecord(entry)) return { reason: 'Each hook must be an object.' };

  const event = entry.event;
  if (typeof event !== 'string' || !EVENTS.includes(event as HookEvent)) {
    return { reason: 'An "event" of either "preToolUse" or "postToolUse" is required.' };
  }

  const rawCommand = entry.command;
  if (typeof rawCommand !== 'string' || !rawCommand.trim()) {
    return { reason: 'A non-empty "command" is required (an executable, not a shell line).' };
  }
  const command = rawCommand.trim();
  if (command.length > MAX_COMMAND || command.includes('\0')) return { reason: '"command" is not usable.' };

  const args = parseArguments(entry.args);
  if ('reason' in args) return args;

  const match = parseMatch(entry.match);
  if ('reason' in match) return match;

  const timeoutMs = parseTimeout(entry.timeoutMs);
  if ('reason' in timeoutMs) return timeoutMs;

  const onError = parseFailurePolicy(entry.onError, event as HookEvent);
  if ('reason' in onError) return onError;

  return {
    event: event as HookEvent,
    command,
    args: args.value,
    match: match.value,
    timeoutMs: timeoutMs.value,
    onError: onError.value
  };
}

function parseArguments(value: unknown): { value: string[] } | { reason: string } {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { reason: '"args" must be an array of strings.' };
  if (value.length > MAX_ARGUMENTS) return { reason: `"args" must have at most ${MAX_ARGUMENTS} entries.` };
  const args: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { reason: '"args" must contain only strings.' };
    if (item.length > MAX_ARGUMENT || item.includes('\0')) return { reason: 'An "args" entry is not usable.' };
    args.push(item);
  }
  return { value: args };
}

function parseMatch(value: unknown): { value: string } | { reason: string } {
  if (value === undefined) return { value: '*' };
  if (typeof value !== 'string') return { reason: '"match" must be a string tool-id pattern.' };
  const match = value.trim();
  if (!match || match.length > MAX_MATCH) return { reason: '"match" is not usable.' };
  return { value: match };
}

function parseTimeout(value: unknown): { value: number } | { reason: string } {
  if (value === undefined) return { value: DEFAULT_TIMEOUT_MS };
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    return { reason: `"timeoutMs" must be an integer between 1 and ${MAX_TIMEOUT_MS}.` };
  }
  return { value };
}

function parseFailurePolicy(
  value: unknown,
  event: HookEvent
): { value: HookFailurePolicy } | { reason: string } {
  if (value === undefined) {
    // A guardrail that silently stops guarding is worse than one that stops the
    // action, so a pre-tool hook fails closed by default; a post-tool hook only
    // adds context, so it fails open. Both are overridable, explicitly.
    return { value: event === 'preToolUse' ? 'block' : 'continue' };
  }
  if (value !== 'block' && value !== 'continue') return { reason: '"onError" must be "block" or "continue".' };
  return { value };
}

/**
 * Matches a tool id against a hook's pattern. `*` is the only wildcard, which
 * covers the two cases that matter in practice: an exact tool id, and a whole
 * namespace such as `mcp__github__*`.
 */
export function hookMatchesTool(pattern: string, toolId: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(toolId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
