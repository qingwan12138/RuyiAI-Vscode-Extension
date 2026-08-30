import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { PermissionMode, YisiSession } from '../domain/session';

const STORAGE_KEY = 'yisiAI.sessions.v1';

export class SessionStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): YisiSession[] {
    return this.context.workspaceState.get<YisiSession[]>(STORAGE_KEY, []);
  }

  async create(workspaceId: string, providerId = '', modelId = '', permissionMode: PermissionMode = 'plan'): Promise<YisiSession> {
    const now = Date.now();
    const session: YisiSession = {
      id: randomUUID(),
      workspaceId,
      title: 'New Chat',
      titleSource: 'fallback',
      model: { providerId, modelId },
      permissionMode,
      executionWorkspace: { kind: 'current', uri: workspaceId },
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      items: []
    };
    await this.save([...this.list(), session]);
    return session;
  }

  async update(next: YisiSession): Promise<void> {
    const all = this.list();
    const index = all.findIndex(s => s.id === next.id);
    if (index >= 0) all[index] = { ...next, updatedAt: Date.now() };
    else all.push(next);
    await this.save(all);
  }

  async remove(sessionId: string): Promise<void> {
    await this.save(this.list().filter(s => s.id !== sessionId));
  }

  private async save(sessions: YisiSession[]): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, sessions);
  }
}
