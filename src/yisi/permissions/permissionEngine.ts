import { PermissionMode } from '../domain/session';
import { ToolRisk } from '../domain/tool';

export type PermissionOutcome = 'allow' | 'confirm' | 'deny';

export interface ToolPermissionRequest {
  risk: ToolRisk;
  mutatesWorkspace: boolean;
}

export interface PermissionDecision {
  outcome: PermissionOutcome;
  allowed: boolean;
  needsConfirmation: boolean;
  reason: string;
}

const KNOWN_RISKS: readonly ToolRisk[] = [
  'readOnly',
  'workspaceWrite',
  'processExec',
  'network',
  'environmentChange',
  'destructive',
  'credentialSensitive'
];

export class PermissionEngine {
  evaluate(mode: PermissionMode, request: ToolPermissionRequest): PermissionDecision {
    if (!isConsistent(request)) {
      return deny('Tool risk metadata is unknown or inconsistent.');
    }
    if (request.risk === 'readOnly') {
      return allow('Read-only workspace action.');
    }
    if (mode === 'plan') {
      return deny('Plan mode blocks state-changing and privileged actions.');
    }
    if (mode === 'manual') {
      return confirm('Manual mode requires approval for this action.');
    }
    if (mode === 'acceptEdits') {
      return request.risk === 'workspaceWrite'
        ? allow('Accept Edits mode permits workspace file changes.')
        : confirm('Accept Edits mode still requires approval for privileged actions.');
    }
    if (mode === 'auto') {
      return request.risk === 'workspaceWrite'
        ? allow('Auto mode permits bounded workspace file changes.')
        : confirm('Auto mode requires approval until this privileged action is classified more narrowly.');
    }
    if (request.risk === 'destructive' || request.risk === 'credentialSensitive') {
      return confirm('Full Access retains confirmation for destructive or credential-sensitive actions.');
    }
    return allow('Full Access permits this declared action.');
  }
}

function isConsistent(request: ToolPermissionRequest): boolean {
  if (!KNOWN_RISKS.includes(request.risk)) return false;
  if (request.risk === 'readOnly') return request.mutatesWorkspace === false;
  if (request.risk === 'workspaceWrite') return request.mutatesWorkspace === true;
  return typeof request.mutatesWorkspace === 'boolean';
}

function allow(reason: string): PermissionDecision {
  return { outcome: 'allow', allowed: true, needsConfirmation: false, reason };
}

function confirm(reason: string): PermissionDecision {
  return { outcome: 'confirm', allowed: true, needsConfirmation: true, reason };
}

function deny(reason: string): PermissionDecision {
  return { outcome: 'deny', allowed: false, needsConfirmation: false, reason };
}
