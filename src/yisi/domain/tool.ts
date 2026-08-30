export type ToolRisk = 'readOnly' | 'workspaceWrite' | 'processExec' | 'network' | 'environmentChange' | 'destructive' | 'credentialSensitive';

export interface ToolExecutionContext {
  sessionId: string;
  workspaceUri: string;
  signal: AbortSignal;
}

export interface YisiTool<TInput = unknown, TResult = unknown> {
  id: string;
  description: string;
  risk: ToolRisk;
  mutatesWorkspace: boolean;
  supportsCancellation: boolean;
  inputSchema: Readonly<Record<string, unknown>>;
  execute(input: TInput, context: ToolExecutionContext): Promise<TResult>;
}
