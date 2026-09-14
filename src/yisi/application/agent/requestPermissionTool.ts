import { PermissionMode } from '../../domain/session';
import { YisiTool } from '../../domain/tool';
import { normalizePlan } from './planReview';

export const REQUEST_PERMISSION_TOOL_ID = 'request_permission';

/** Justification is shown to the user in the approval card, so keep it short. */
const MAX_JUSTIFICATION_CHARACTERS = 240;

/** Modes a run may ask to be widened to. `plan` is the narrowest, so it is never a target. */
const WIDENABLE_MODES: readonly PermissionMode[] = ['manual', 'acceptEdits', 'auto', 'fullAccess'];

/**
 * Ask the user to widen the permission mode for the rest of this run.
 *
 * The tool does no work: AgentToolLoop intercepts it, enforces that the request
 * is grounded in a refusal that actually happened and is strictly wider than the
 * current mode, and routes the question through the same approval card every
 * privileged action uses. That is what gives Plan mode a reviewed exit — the
 * agent says what it wants to apply and asks to be allowed to apply it — and it
 * is the structured escalation Codex (`request_permissions`) and the DeepSeek
 * Harness (one grounded, strictly wider, human-approved retry) both document.
 *
 * The session's stored mode is never touched: an approval lasts until the run
 * ends, so a one-off "go ahead with this" cannot silently change the user's
 * standing setting.
 */
export function createRequestPermissionTool(): YisiTool {
  return {
    id: REQUEST_PERMISSION_TOOL_ID,
    description: [
      'Ask the user to allow this run to continue in a wider permission mode, after an action was refused.',
      'Use it when the refusal blocks work the user clearly asked for, for example when a plan is ready to apply.',
      'It works at most once per run, only after a refusal, and only for a mode strictly wider than the current one.',
      'Give a one-line justification: what you need to do and why it is safe.',
      'In Plan mode, put the finished plan in "plan": it is opened as a document the user can read and comment on, and anything they change there comes back to you as feedback.'
    ].join(' '),
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    permissionEscalation: true,
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: [...WIDENABLE_MODES],
          description: 'The wider mode to continue in for the rest of this run.'
        },
        justification: {
          type: 'string',
          description: 'One line for the user: what needs to run and why it is safe.'
        },
        plan: {
          type: 'string',
          description:
            'Optional markdown plan of what you would apply. In Plan mode, submit the finished plan here: '
            + 'it is opened as a document the user can read and comment on before approving.'
        }
      },
      required: ['mode', 'justification'],
      additionalProperties: false
    },
    async execute(): Promise<never> {
      // AgentToolLoop intercepts this tool before execution. Reaching here means
      // the interception was lost, so fail closed instead of pretending the mode
      // changed.
      throw new Error('request_permission is handled by the agent loop and must never execute.');
    }
  };
}

export interface PermissionEscalationRequest {
  mode: PermissionMode;
  justification: string;
  /** Markdown plan, when the model submitted one for review. */
  plan?: string;
}

/** Parses the tool input, returning undefined for anything malformed. */
export function parsePermissionEscalation(input: unknown): PermissionEscalationRequest | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const mode = record.mode;
  if (typeof mode !== 'string' || !WIDENABLE_MODES.includes(mode as PermissionMode)) return undefined;
  const rawJustification = record.justification;
  if (typeof rawJustification !== 'string') return undefined;
  const justification = rawJustification.replace(/\s+/g, ' ').trim();
  if (!justification) return undefined;
  const plan = normalizePlan(record.plan);
  return {
    mode: mode as PermissionMode,
    justification: justification.length <= MAX_JUSTIFICATION_CHARACTERS
      ? justification
      : `${justification.slice(0, MAX_JUSTIFICATION_CHARACTERS - 1)}…`,
    ...(plan ? { plan } : {})
  };
}
