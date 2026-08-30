export type PermissionMode = 'plan' | 'manual' | 'acceptEdits' | 'auto' | 'fullAccess';

export interface SessionModelSelection {
  providerId: string;
  modelId: string;
}

export interface YisiSession {
  id: string;
  title: string;
  workspaceId: string;
  model: SessionModelSelection;
  permissionMode: PermissionMode;
  createdAt: number;
  updatedAt: number;
  userRenamed: boolean;
  status: 'idle' | 'running' | 'interrupted' | 'blocked';
  worktreePath?: string;
}
