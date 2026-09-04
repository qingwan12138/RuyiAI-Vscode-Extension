import type { ModelControlState } from '../application/modelControl/modelControlService';
import type { PermissionMode } from '../domain/session';
import type { ContextUsageState } from '../application/context/contextUsage';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'newChat' }
  | { type: 'openSettings' }
  | { type: 'stop' }
  | { type: 'continue' }
  | { type: 'addContext' }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'clearContext' }
  | { type: 'permission.setMode'; value: PermissionMode }
  | { type: 'sendMessage'; text: string }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'deleteSession'; sessionId: string; confirmed: true }
  | { type: 'modelControl.selectModel'; providerId: string; modelId: string }
  | { type: 'modelControl.setReasoning'; value: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' }
  | { type: 'modelControl.setSpeed'; value: 'standard' | 'fast' }
  | { type: 'modelControl.setTemperature'; value: number }
  | { type: 'modelControl.setMaxTokens'; value: number };

export type HostMessage =
  | { type: 'sessionState'; sessions: unknown[]; activeSession: unknown }
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'continueRequested' }
  | { type: 'sessionError'; message: string }
  | { type: 'contextState'; contexts: unknown[] }
  | { type: 'modelControl.state'; state: ModelControlState }
  | { type: 'contextUsage'; usage: ContextUsageState | null };

export class WebviewProtocolError extends Error {
  constructor() {
    super('Invalid Webview message.');
    this.name = 'WebviewProtocolError';
  }
}

const PAYLOAD_FREE_TYPES = new Set([
  'ready',
  'newChat',
  'openSettings',
  'stop',
  'continue',
  'addContext',
  'clearContext'
]);

export function parseWebviewMessage(value: unknown): WebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new WebviewProtocolError();
  }

  if (PAYLOAD_FREE_TYPES.has(value.type) && hasExactKeys(value, ['type'])) {
    return { type: value.type } as WebviewMessage;
  }

  if (
    value.type === 'sendMessage'
    && hasExactKeys(value, ['type', 'text'])
    && isNonBlank(value.text)
  ) {
    return { type: 'sendMessage', text: value.text };
  }

  if (
    value.type === 'switchSession'
    && hasExactKeys(value, ['type', 'sessionId'])
    && isNonBlank(value.sessionId)
  ) {
    return { type: 'switchSession', sessionId: value.sessionId };
  }

  if (
    value.type === 'renameSession'
    && hasExactKeys(value, ['type', 'sessionId', 'title'])
    && isNonBlank(value.sessionId)
    && isNonBlank(value.title)
  ) {
    return { type: 'renameSession', sessionId: value.sessionId, title: value.title };
  }

  if (
    value.type === 'removeAttachment'
    && hasExactKeys(value, ['type', 'attachmentId'])
    && isNonBlank(value.attachmentId)
  ) {
    return { type: 'removeAttachment', attachmentId: value.attachmentId };
  }

  if (
    value.type === 'deleteSession'
    && hasExactKeys(value, ['type', 'sessionId', 'confirmed'])
    && isNonBlank(value.sessionId)
    && value.confirmed === true
  ) {
    return { type: 'deleteSession', sessionId: value.sessionId, confirmed: true };
  }

  if (
    value.type === 'permission.setMode'
    && hasExactKeys(value, ['type', 'value'])
    && isPermissionMode(value.value)
  ) {
    return { type: 'permission.setMode', value: value.value };
  }

  if (
    value.type === 'modelControl.selectModel'
    && hasExactKeys(value, ['type', 'providerId', 'modelId'])
    && isNonBlank(value.providerId)
    && isNonBlank(value.modelId)
  ) {
    return { type: 'modelControl.selectModel', providerId: value.providerId, modelId: value.modelId };
  }

  if (
    value.type === 'modelControl.setReasoning'
    && hasExactKeys(value, ['type', 'value'])
    && isReasoningEffort(value.value)
  ) {
    return { type: 'modelControl.setReasoning', value: value.value };
  }

  if (
    value.type === 'modelControl.setSpeed'
    && hasExactKeys(value, ['type', 'value'])
    && isSpeedMode(value.value)
  ) {
    return { type: 'modelControl.setSpeed', value: value.value };
  }

  if (
    value.type === 'modelControl.setTemperature'
    && hasExactKeys(value, ['type', 'value'])
    && isFiniteNumber(value.value)
    && (value.value as number) >= 0
    && (value.value as number) <= 2
  ) {
    return { type: 'modelControl.setTemperature', value: value.value };
  }

  if (
    value.type === 'modelControl.setMaxTokens'
    && hasExactKeys(value, ['type', 'value'])
    && isFiniteNumber(value.value)
    && Number.isInteger(value.value)
    && value.value > 0
    && value.value <= 1_000_000
  ) {
    return { type: 'modelControl.setMaxTokens', value: value.value };
  }

  throw new WebviewProtocolError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isReasoningEffort(value: unknown): value is 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' {
  return value === 'auto'
    || value === 'off'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh';
}

function isSpeedMode(value: unknown): value is 'standard' | 'fast' {
  return value === 'standard' || value === 'fast';
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'plan'
    || value === 'manual'
    || value === 'acceptEdits'
    || value === 'auto'
    || value === 'fullAccess';
}
