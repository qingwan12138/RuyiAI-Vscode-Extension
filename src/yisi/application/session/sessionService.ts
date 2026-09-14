import {
  AssistantMessage,
  ConversationContextReference,
  PermissionMode,
  ReasoningPreset,
  SessionDocument,
  SessionStatus,
  SessionSummary,
  SpeedMode,
  YisiSession,
  parseContextReferences,
  parseSessionDocument
} from '../../domain/session';
import { SessionRepository } from './sessionRepository';

export interface LegacySessionMetadata {
  id: string;
  title: string;
  workspaceId: string;
  model: { providerId: string; modelId: string };
  permissionMode: PermissionMode;
  createdAt: number;
  updatedAt: number;
  userRenamed: boolean;
  status: SessionStatus;
  worktreePath?: string;
}

export interface SessionServiceOptions {
  now?: () => number;
  createId?: () => string;
}

export class SessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionInputError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionService {
  private readonly now: () => number;
  private readonly createId: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();
  private document?: SessionDocument;
  private workspaceId?: string;

  constructor(
    private readonly repository: SessionRepository,
    options: SessionServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  initialize(
    workspaceId: string,
    legacySessions: LegacySessionMetadata[] = []
  ): Promise<{ importedLegacy: boolean }> {
    return this.enqueue(async () => {
      const loaded = await this.repository.load();
      const next: SessionDocument = loaded ?? { schemaVersion: 1, workspaces: {} };
      let importedLegacy = false;
      let changed = loaded === undefined;
      let workspace = next.workspaces[workspaceId];

      if (!workspace || workspace.sessions.length === 0) {
        const imported = legacySessions
          .filter(session => session.workspaceId === workspaceId)
          .map(session => this.fromLegacy(session));
        importedLegacy = imported.length > 0;
        const sessions = importedLegacy ? imported : [this.createBlankSession(workspaceId)];
        workspace = {
          activeSessionId: mostRecentlyUpdated(sessions).id,
          sessions
        };
        next.workspaces[workspaceId] = workspace;
        changed = true;
      } else if (!workspace.activeSessionId) {
        workspace.activeSessionId = mostRecentlyUpdated(workspace.sessions).id;
        changed = true;
      }

      if (changed) {
        await this.repository.save(next);
      }
      this.document = parseSessionDocument(next);
      this.workspaceId = workspaceId;
      return { importedLegacy };
    });
  }

  listSessions(): SessionSummary[] {
    const workspace = this.currentWorkspace();
    return [...workspace.sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(session => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        status: session.status,
        active: session.id === workspace.activeSessionId
      }));
  }

  // Sessions that reference a given provider instance (active or not). Used to
  // warn before deleting a provider; never used to mutate the sessions.
  findByProvider(providerInstanceId: string): string[] {
    const workspace = this.currentWorkspace();
    return workspace.sessions
      .filter(session => session.model.providerId === providerInstanceId)
      .map(session => session.id);
  }

  getActiveSession(): YisiSession {
    const workspace = this.currentWorkspace();
    const session = workspace.sessions.find(candidate => candidate.id === workspace.activeSessionId);
    if (!session) {
      throw new Error('The active session is unavailable.');
    }
    return structuredClone(session);
  }

  createSession(): Promise<YisiSession> {
    return this.enqueue(() => this.mutate(workspace => {
      const session = this.createBlankSession(this.requiredWorkspaceId());
      workspace.sessions.push(session);
      workspace.activeSessionId = session.id;
      return structuredClone(session);
    }));
  }

  switchSession(sessionId: string): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      this.findSession(workspace.sessions, sessionId);
      workspace.activeSessionId = sessionId;
    }));
  }

  renameSession(sessionId: string, title: string): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      const normalized = requireText(title, 'Session title');
      const session = this.findSession(workspace.sessions, sessionId);
      session.title = normalized;
      session.titleSource = 'manual';
      session.updatedAt = this.now();
    }));
  }

  /**
   * Applies a title generated from the session's first exchange. Returns whether
   * it was applied. A user rename always wins: the title request is in flight
   * while the user may be renaming the same session, and `renameSession` marks
   * the session 'manual', which this refuses to overwrite.
   */
  setAiTitle(sessionId: string, title: string): Promise<boolean> {
    return this.enqueue(() => this.mutate(workspace => {
      const normalized = requireText(title, 'Session title');
      const session = this.findSession(workspace.sessions, sessionId);
      if (session.titleSource === 'manual') return false;
      if (session.titleSource === 'ai' && session.title === normalized) return false;
      session.title = normalized;
      session.titleSource = 'ai';
      session.updatedAt = this.now();
      return true;
    }));
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      const index = workspace.sessions.findIndex(session => session.id === sessionId);
      if (index < 0) {
        throw new SessionNotFoundError(sessionId);
      }
      workspace.sessions.splice(index, 1);
      if (workspace.sessions.length === 0) {
        const replacement = this.createBlankSession(this.requiredWorkspaceId());
        workspace.sessions.push(replacement);
        workspace.activeSessionId = replacement.id;
      } else if (workspace.activeSessionId === sessionId) {
        workspace.activeSessionId = mostRecentlyUpdated(workspace.sessions).id;
      }
    }));
  }

  appendUserMessage(text: string, contexts: ConversationContextReference[] = []): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      const normalized = requireText(text, 'Message');
      const normalizedContexts = parseContextReferences(contexts);
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      const createdAt = this.now();
      const message = {
        id: this.createId(),
        type: 'userMessage' as const,
        text: normalized,
        createdAt
      };
      session.items.push(normalizedContexts.length === 0 ? message : { ...message, contexts: normalizedContexts });
      session.updatedAt = createdAt;
    }));
  }

  appendAssistantMessage(text: string, source: AssistantMessage['source']): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      const normalized = requireText(text, 'Message');
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      const createdAt = this.now();
      session.items.push({
        id: this.createId(),
        type: 'assistantMessage',
        text: normalized,
        source,
        createdAt
      });
      session.updatedAt = createdAt;
    }));
  }

  setModelSelection(model: YisiSession['model']): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.model = { ...model };
      session.updatedAt = this.now();
    }));
  }

  setReasoningEffort(effort: ReasoningPreset): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      if (!isReasoningPreset(effort)) throw new SessionInputError('Reasoning preset is invalid.');
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.model = { ...session.model, reasoningEffort: effort };
      session.updatedAt = this.now();
    }));
  }

  setSpeedMode(mode: SpeedMode): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      if (!isSpeedMode(mode)) throw new SessionInputError('Speed mode is invalid.');
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.model = { ...session.model, speedMode: mode };
      session.updatedAt = this.now();
    }));
  }

  setTemperature(value: number): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      if (!isFinite(value) || value < 0 || value > 2) throw new SessionInputError('Temperature is invalid.');
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.model = { ...session.model, temperature: value };
      session.updatedAt = this.now();
    }));
  }

  setMaxTokens(value: number): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) {
        throw new SessionInputError('Max tokens is invalid.');
      }
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.model = { ...session.model, maxTokens: value };
      session.updatedAt = this.now();
    }));
  }

  setPermissionMode(mode: PermissionMode): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      if (!isPermissionMode(mode)) throw new SessionInputError('Permission mode is invalid.');
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.permissionMode = mode;
      session.updatedAt = this.now();
    }));
  }

  setStatus(status: YisiSession['status']): Promise<void> {
    return this.enqueue(() => this.mutate(workspace => {
      const session = this.activeSession(workspace.sessions, workspace.activeSessionId);
      session.status = status;
      session.updatedAt = this.now();
    }));
  }

  private async mutate<T>(
    change: (workspace: SessionDocument['workspaces'][string]) => T
  ): Promise<T> {
    const next = parseSessionDocument(this.requiredDocument());
    const workspace = next.workspaces[this.requiredWorkspaceId()];
    const result = change(workspace);
    await this.repository.save(next);
    this.document = next;
    return result;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.then(operation, operation);
    this.mutationQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private createBlankSession(workspaceId: string): YisiSession {
    const now = this.now();
    return {
      id: this.createId(),
      workspaceId,
      title: 'New Chat',
      titleSource: 'fallback',
      model: { providerId: '', modelId: '' },
      permissionMode: 'plan',
      executionWorkspace: { kind: 'current', uri: workspaceId },
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      items: []
    };
  }

  private fromLegacy(session: LegacySessionMetadata): YisiSession {
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      title: session.title,
      titleSource: session.userRenamed ? 'manual' : 'fallback',
      model: { ...session.model },
      permissionMode: session.permissionMode,
      executionWorkspace: session.worktreePath
        ? { kind: 'worktree', uri: session.worktreePath, worktreeId: session.worktreePath }
        : { kind: 'current', uri: session.workspaceId },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      items: []
    };
  }

  private currentWorkspace(): SessionDocument['workspaces'][string] {
    return this.requiredDocument().workspaces[this.requiredWorkspaceId()];
  }

  private requiredDocument(): SessionDocument {
    if (!this.document) {
      throw new Error('SessionService has not been initialized.');
    }
    return this.document;
  }

  private requiredWorkspaceId(): string {
    if (!this.workspaceId) {
      throw new Error('SessionService has not been initialized.');
    }
    return this.workspaceId;
  }

  private findSession(sessions: YisiSession[], sessionId: string): YisiSession {
    const session = sessions.find(candidate => candidate.id === sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  private activeSession(sessions: YisiSession[], activeSessionId?: string): YisiSession {
    if (!activeSessionId) {
      throw new Error('The active session is unavailable.');
    }
    return this.findSession(sessions, activeSessionId);
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SessionInputError(`${label} must not be empty.`);
  }
  return normalized;
}

function mostRecentlyUpdated(sessions: YisiSession[]): YisiSession {
  return sessions.reduce((latest, session) => (
    session.updatedAt > latest.updatedAt ? session : latest
  ));
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'plan'
    || value === 'manual'
    || value === 'acceptEdits'
    || value === 'auto'
    || value === 'fullAccess';
}

function isReasoningPreset(value: unknown): value is ReasoningPreset {
  return value === 'auto'
    || value === 'off'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh';
}

function isSpeedMode(value: unknown): value is SpeedMode {
  return value === 'standard' || value === 'fast';
}
