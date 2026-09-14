import { YisiTool } from '../../domain/tool';

/**
 * The `task` tool: runs a focused subagent and returns only its report.
 *
 * Clean-room note: the behaviour was studied from published documentation
 * (docs/04) — a subagent runs its own loop in an isolated context and the parent
 * receives a summary rather than the transcript, which is what makes it useful
 * when a task needs many file reads. No implementation or prompt text was copied.
 *
 * ## Why a subagent here is read-only
 *
 * This is the decision that shapes everything else, so it is worth stating:
 *
 *  1. Context isolation is the documented reason subagents exist. "Read a lot,
 *     report a little" is the whole value, and it needs no write access.
 *  2. Yisi's edit model is single-threaded by design — one edit journal, a
 *     SHA-256 stale guard, one approval at a time. Two loops writing the same
 *     worktree would race that model, and the race would be invisible.
 *  3. Read-only makes "a subagent can never exceed its parent's permissions" a
 *     **structural** guarantee instead of a policy: the child's tool set is
 *     filtered to read-only observers, so there is no privileged tool to reach
 *     for, no escalation tool to ask with, and nothing to approve.
 *
 * Write-capable subagents are therefore **not implemented**, not forgotten. If
 * they are ever added they need a concurrency story first (separate worktrees, at
 * minimum), which is a design of its own.
 */

export const SUBAGENT_TOOL_ID = 'task';

export const SUBAGENT_DESCRIPTION_CHARACTERS = 120;
export const SUBAGENT_PROMPT_CHARACTERS = 8_000;
/** Bound on the report handed back to the parent. */
export const SUBAGENT_REPORT_CHARACTERS = 8_000;

export interface SubagentTask {
  /** Short label, used in the UI and in messages. */
  description: string;
  /** The self-contained task for the subagent. */
  prompt: string;
}

export class SubagentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentInputError';
  }
}

export function parseSubagentTask(input: unknown): SubagentTask {
  if (!isRecord(input)) throw new SubagentInputError('The task input must be an object.');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!description) throw new SubagentInputError('A short "description" is required.');
  if (!prompt) throw new SubagentInputError('A "prompt" describing the task is required.');
  if (description.length > SUBAGENT_DESCRIPTION_CHARACTERS) {
    throw new SubagentInputError(`"description" must be at most ${SUBAGENT_DESCRIPTION_CHARACTERS} characters.`);
  }
  if (prompt.length > SUBAGENT_PROMPT_CHARACTERS) {
    throw new SubagentInputError(`"prompt" must be at most ${SUBAGENT_PROMPT_CHARACTERS} characters.`);
  }
  return { description, prompt };
}

/**
 * The tool handed to the parent agent. `execute` always throws: the loop
 * intercepts the call (marker `spawnsSubagent`) and runs the nested loop itself —
 * a tool body has no access to the provider, the registry or the mode. Marked
 * `readOnly` because the subagent itself can only observe.
 */
export function createSubagentTool(): YisiTool {
  return {
    id: SUBAGENT_TOOL_ID,
    description:
      'Run a focused subagent that works in its own context and returns only its report. '
      + 'Use it when a task needs many file reads or searches whose intermediate output you do not want in this conversation. '
      + 'The subagent has read-only tools: it cannot change the workspace. It also cannot ask the user anything, '
      + 'so the prompt must be self-contained.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    spawnsSubagent: true,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', minLength: 1, description: 'Short label for the task, e.g. "find the auth flow".' },
        prompt: {
          type: 'string',
          minLength: 1,
          description: 'The complete task for the subagent. It sees only this text, not the conversation.'
        }
      },
      required: ['description', 'prompt'],
      additionalProperties: false
    },
    execute: async () => {
      throw new Error('The subagent tool is intercepted by the agent loop and must never execute directly.');
    }
  };
}

/**
 * The brief the child receives, placed in the request head right after the role
 * prompt. It states the three things a subagent gets wrong otherwise: it is not
 * talking to the user, it cannot change anything, and only its report travels
 * back.
 */
export function subagentBrief(task: SubagentTask): string {
  return [
    `You are a subagent working for another agent — not for the user. Your task: ${task.description}`,
    '',
    'How to work:',
    '- You cannot ask the user anything. No question you write will be answered. If something is missing or ambiguous, decide, and say what you assumed in your report.',
    '- You have read-only tools. You cannot change the workspace and there is nothing to approve; do not try.',
    '- Do the task, then finish with a concise report: what you found, the exact file paths (and line numbers where useful), and what you could not determine.',
    '- Only that report reaches the other agent. Your file reads, searches and intermediate reasoning do not, so put anything that matters into the report.'
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
