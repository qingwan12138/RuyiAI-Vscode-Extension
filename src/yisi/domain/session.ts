export type PermissionMode = 'plan' | 'manual' | 'acceptEdits' | 'auto' | 'fullAccess';
export type SessionStatus = 'idle' | 'running' | 'interrupted' | 'blocked';

export interface SessionModelSelection {
  providerId: string;
  modelId: string;
}

export interface ExecutionWorkspaceBinding {
  kind: 'current' | 'worktree';
  uri: string;
  worktreeId?: string;
}

export interface UserMessage {
  id: string;
  type: 'userMessage';
  text: string;
  createdAt: number;
  contexts?: ConversationContextReference[];
}

export interface FileContextReference {
  type: 'file';
  path: string;
  workspaceFolderUri: string;
}

export type ConversationContextReference = FileContextReference;

export interface AssistantMessage {
  id: string;
  type: 'assistantMessage';
  text: string;
  source: 'baseline' | 'provider';
  createdAt: number;
}

export type ConversationItem = UserMessage | AssistantMessage;

export interface YisiSession {
  id: string;
  workspaceId: string;
  title: string;
  titleSource: 'manual' | 'ai' | 'fallback';
  model: SessionModelSelection;
  permissionMode: PermissionMode;
  executionWorkspace: ExecutionWorkspaceBinding;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  items: ConversationItem[];
}

export interface WorkspaceSessionState {
  activeSessionId?: string;
  sessions: YisiSession[];
}

export interface SessionDocument {
  schemaVersion: 1;
  workspaces: Record<string, WorkspaceSessionState>;
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  status: SessionStatus;
  active: boolean;
}

export class SessionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionSchemaError';
  }
}

export function parseSessionDocument(value: unknown): SessionDocument {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new SessionSchemaError('Unsupported session schema.');
  }
  if (!isRecord(value.workspaces)) {
    throw malformed();
  }

  const workspaces: Record<string, WorkspaceSessionState> = {};
  for (const [workspaceId, workspaceValue] of Object.entries(value.workspaces)) {
    workspaces[workspaceId] = parseWorkspaceState(workspaceId, workspaceValue);
  }

  return { schemaVersion: 1, workspaces };
}

function parseWorkspaceState(workspaceId: string, value: unknown): WorkspaceSessionState {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw malformed();
  }
  if (value.activeSessionId !== undefined && typeof value.activeSessionId !== 'string') {
    throw malformed();
  }

  const sessions = value.sessions.map(session => parseSession(workspaceId, session));
  const activeSessionId = value.activeSessionId;
  if (activeSessionId !== undefined && !sessions.some(session => session.id === activeSessionId)) {
    throw new SessionSchemaError('Workspace active session does not exist in its session list.');
  }

  return activeSessionId === undefined ? { sessions } : { activeSessionId, sessions };
}

function parseSession(workspaceId: string, value: unknown): YisiSession {
  if (
    !isRecord(value)
    || !isString(value.id)
    || value.workspaceId !== workspaceId
    || !isString(value.title)
    || !isOneOf(value.titleSource, ['manual', 'ai', 'fallback'])
    || !isRecord(value.model)
    || typeof value.model.providerId !== 'string'
    || typeof value.model.modelId !== 'string'
    || !isOneOf(value.permissionMode, ['plan', 'manual', 'acceptEdits', 'auto', 'fullAccess'])
    || !isRecord(value.executionWorkspace)
    || !isOneOf(value.executionWorkspace.kind, ['current', 'worktree'])
    || !isString(value.executionWorkspace.uri)
    || (value.executionWorkspace.worktreeId !== undefined && typeof value.executionWorkspace.worktreeId !== 'string')
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !isOneOf(value.status, ['idle', 'running', 'interrupted', 'blocked'])
    || !Array.isArray(value.items)
  ) {
    throw malformed();
  }

  const executionWorkspace: ExecutionWorkspaceBinding = {
    kind: value.executionWorkspace.kind,
    uri: value.executionWorkspace.uri
  };
  if (typeof value.executionWorkspace.worktreeId === 'string') {
    executionWorkspace.worktreeId = value.executionWorkspace.worktreeId;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    title: value.title,
    titleSource: value.titleSource,
    model: { providerId: value.model.providerId, modelId: value.model.modelId },
    permissionMode: value.permissionMode,
    executionWorkspace,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    status: value.status,
    items: value.items.map(parseConversationItem)
  };
}

function parseConversationItem(value: unknown): ConversationItem {
  if (
    !isRecord(value)
    || !isString(value.id)
    || !isString(value.text)
    || !isTimestamp(value.createdAt)
  ) {
    throw malformed();
  }

  if (value.type === 'userMessage') {
    const contexts = parseContextReferences(value.contexts);
    return contexts.length === 0
      ? { id: value.id, type: 'userMessage', text: value.text, createdAt: value.createdAt }
      : { id: value.id, type: 'userMessage', text: value.text, createdAt: value.createdAt, contexts };
  }
  if (value.type === 'assistantMessage' && isOneOf(value.source, ['baseline', 'provider'])) {
    return {
      id: value.id,
      type: 'assistantMessage',
      text: value.text,
      source: value.source,
      createdAt: value.createdAt
    };
  }
  throw malformed();
}

export function parseContextReferences(value: unknown): ConversationContextReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw malformed();
  return value.map(context => {
    if (
      !isRecord(context)
      || !hasExactKeys(context, ['type', 'path', 'workspaceFolderUri'])
      || context.type !== 'file'
      || !isString(context.path)
      || !isString(context.workspaceFolderUri)
    ) {
      throw malformed();
    }
    return { type: 'file', path: context.path, workspaceFolderUri: context.workspaceFolderUri };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function malformed(): SessionSchemaError {
  return new SessionSchemaError('Malformed session document.');
}
