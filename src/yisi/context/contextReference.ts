export type ContextReferenceType =
  | 'file'
  | 'folder'
  | 'symbol'
  | 'selection'
  | 'diagnostics'
  | 'terminal'
  | 'git-diff'
  | 'ruyi-env';

export interface ContextReference {
  type: ContextReferenceType;
  uri?: string;
  range?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  symbolName?: string;
  metadata?: Record<string, unknown>;
}
