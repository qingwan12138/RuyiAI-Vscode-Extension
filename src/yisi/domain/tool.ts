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
  /**
   * The tool changes this run's permission mode instead of doing work. The agent
   * loop intercepts it, applies the grounding and strictly-wider rules, and asks
   * the user through the same approval card privileged actions use — so the tool
   * itself never executes and its risk class never decides anything.
   */
  permissionEscalation?: boolean;
  /**
   * The tool runs a nested agent loop instead of doing work, so the loop
   * intercepts it (a plain `execute` has no access to the provider, the registry
   * or the mode). Like `permissionEscalation`, this marker is what the loop keys
   * on — never a hardcoded tool name.
   */
  spawnsSubagent?: boolean;
  execute(input: TInput, context: ToolExecutionContext): Promise<TResult>;
}
