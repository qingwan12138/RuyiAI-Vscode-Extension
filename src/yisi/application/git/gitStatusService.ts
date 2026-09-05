import { GitPort } from '../../domain/gitPort';
import { YisiTool } from '../../domain/tool';

const MAX_CHANGED_FILES = 300;

export interface GitStatusToolResult {
  isRepo: boolean;
  branch: string | null;
  clean: boolean;
  changedFiles: Array<{ path: string; status: string; renamedFrom?: string }>;
  raw: string;
}

export class GitStatusService {
  constructor(private readonly git: GitPort) {}

  async inspect(workspaceRoot: string, signal?: AbortSignal): Promise<GitStatusToolResult> {
    const status = await this.git.status(workspaceRoot, signal);
    return {
      isRepo: status.isRepo,
      branch: status.branch,
      clean: status.clean,
      changedFiles: status.entries.slice(0, MAX_CHANGED_FILES).map(entry => ({
        path: entry.path,
        status: entry.status,
        ...(entry.renamedFrom !== undefined ? { renamedFrom: entry.renamedFrom } : {})
      })),
      raw: status.raw
    };
  }
}

export function createGitStatusTool(service: GitStatusService, workspaceRoot: string): YisiTool {
  return {
    id: 'git_status',
    description:
      'Report the git state of the active workspace: repo/branch, whether the tree is clean, and the list of changed files with their porcelain status. Use it before destructive edits to avoid overwriting uncommitted user work.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_input, context) => {
      const result = await service.inspect(workspaceRoot, context.signal);
      return {
        isRepo: result.isRepo,
        branch: result.branch,
        clean: result.clean,
        changedFiles: result.changedFiles,
        ...(result.raw ? { raw: result.raw } : {})
      };
    }
  };
}
