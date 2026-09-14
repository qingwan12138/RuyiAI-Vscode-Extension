import { PermissionMode } from './session';

/**
 * Permission modes ordered from least to most permissive.
 *
 * This is the file-effect axis a mode really controls: what may run without
 * asking. It exists so an escalation request can be checked for being *strictly*
 * wider rather than merely different — the rule Codex and the DeepSeek Harness
 * both document for a one-off permission increase (docs/04).
 *
 * `acceptEdits` and `auto` sit next to each other because PermissionEngine
 * currently treats them identically (both allow workspace writes and confirm
 * everything else). They stay separate so narrowing one later remains
 * expressible, and their relative order is therefore nominal.
 */
export const PERMISSION_MODE_ORDER: readonly PermissionMode[] = [
  'plan',
  'manual',
  'acceptEdits',
  'auto',
  'fullAccess'
];

export function permissionModeRank(mode: PermissionMode): number {
  return PERMISSION_MODE_ORDER.indexOf(mode);
}

/** True when `candidate` grants strictly more than `current`. */
export function isWiderPermissionMode(current: PermissionMode, candidate: PermissionMode): boolean {
  const from = permissionModeRank(current);
  const to = permissionModeRank(candidate);
  return from >= 0 && to >= 0 && to > from;
}
