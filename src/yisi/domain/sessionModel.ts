export type TurnStatus = 'completed' | 'interrupted' | 'blocked' | 'failed' | 'running';
export type PermissionMode = 'plan' | 'manual' | 'acceptEdits' | 'auto' | 'fullAccess';

export interface ExecutionWorkspaceBinding {
  kind: 'current' | 'worktree';
  uri: string;
  worktreeId?: string;
}

export interface YisiSession {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  titleSource: 'ai' | 'manual' | 'fallback';
  providerId: string;
  modelId: string;
  permissionMode: PermissionMode;
  executionWorkspace: ExecutionWorkspaceBinding;
  createdAt: string;
  updatedAt: string;
}
