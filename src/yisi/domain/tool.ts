export type ToolRisk = 'readOnly' | 'workspaceWrite' | 'processExec' | 'network' | 'environmentChange' | 'destructive' | 'credentialSensitive';

export interface ToolExecutionContext {
  sessionId: string;
  workspaceUri: string;
  signal: AbortSignal;
}

export interface YisiTool<TInput = unknown, TResult = unknown> {
  id: string;
  risk: ToolRisk;
  mutatesWorkspace: boolean;
  execute(input: TInput, context: ToolExecutionContext): Promise<TResult>;
}
