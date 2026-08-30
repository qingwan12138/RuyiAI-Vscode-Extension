import { PermissionMode } from '../session/types';

export type ToolRisk = 'read' | 'write' | 'command' | 'destructive';

export interface PermissionDecision {
  allowed: boolean;
  needsConfirmation: boolean;
  reason: string;
}

export class PermissionEngine {
  evaluate(mode: PermissionMode, risk: ToolRisk): PermissionDecision {
    if (mode === 'plan') {
      return risk === 'read'
        ? { allowed: true, needsConfirmation: false, reason: 'Plan mode permits read-only actions.' }
        : { allowed: false, needsConfirmation: false, reason: 'Plan mode blocks state-changing actions.' };
    }

    if (mode === 'manual') {
      return risk === 'read'
        ? { allowed: true, needsConfirmation: false, reason: 'Read action.' }
        : { allowed: true, needsConfirmation: true, reason: 'Manual mode requires confirmation.' };
    }

    if (mode === 'acceptEdits') {
      if (risk === 'destructive') return { allowed: true, needsConfirmation: true, reason: 'Destructive action requires confirmation.' };
      if (risk === 'command') return { allowed: true, needsConfirmation: true, reason: 'Command execution requires confirmation.' };
      return { allowed: true, needsConfirmation: false, reason: 'Read/edit allowed.' };
    }

    if (mode === 'auto') {
      return risk === 'destructive'
        ? { allowed: true, needsConfirmation: true, reason: 'High-risk action requires confirmation.' }
        : { allowed: true, needsConfirmation: false, reason: 'Auto mode allows routine actions.' };
    }

    return { allowed: true, needsConfirmation: false, reason: 'Full Access mode.' };
  }
}
