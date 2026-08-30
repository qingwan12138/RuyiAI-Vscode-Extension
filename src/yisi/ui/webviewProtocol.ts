export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'newChat' }
  | { type: 'openSettings' }
  | { type: 'stop' }
  | { type: 'continue' }
  | { type: 'selectModel' }
  | { type: 'selectPermission' }
  | { type: 'addContext' }
  | { type: 'sendMessage'; text: string }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'deleteSession'; sessionId: string; confirmed: true };

export type HostMessage =
  | { type: 'sessionState'; sessions: unknown[]; activeSession: unknown }
  | { type: 'assistantStreamStarted' }
  | { type: 'assistantStreamDelta'; text: string }
  | { type: 'assistantStreamCompleted' }
  | { type: 'runStopped' }
  | { type: 'continueRequested' }
  | { type: 'sessionError'; message: string };

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
  'selectModel',
  'selectPermission',
  'addContext'
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
    value.type === 'deleteSession'
    && hasExactKeys(value, ['type', 'sessionId', 'confirmed'])
    && isNonBlank(value.sessionId)
    && value.confirmed === true
  ) {
    return { type: 'deleteSession', sessionId: value.sessionId, confirmed: true };
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
