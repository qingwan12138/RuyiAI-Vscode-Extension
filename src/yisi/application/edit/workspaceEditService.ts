import { YisiTool } from '../../domain/tool';
import {
  WorkspaceDirectoryCreation,
  WorkspaceDirectoryCreationResult,
  WorkspaceFileDeletion,
  WorkspaceFileDeletionResult,
  WorkspaceFileRename,
  WorkspaceFileRenameResult,
  WorkspaceTextFileRewrite,
  WorkspaceTextFileRewriteResult,
  WorkspaceTextReplacement,
  WorkspaceTextReplacementResult,
  WorkspaceTextFileCreation,
  WorkspaceTextFileCreationResult,
  WorkspaceWritePort
} from '../../context/workspaceContext';
import { DiagnosticProvider, DiagnosticSnapshot } from '../../domain/diagnostics';

const MAX_PATH_CHARACTERS = 4_096;
const MAX_REPLACEMENT_CHARACTERS = 65_536;
const MAX_NEW_FILE_CHARACTERS = 262_144;

export class WorkspaceEditInputError extends Error {
  constructor(message = 'Invalid workspace edit input.') {
    super(message);
    this.name = 'WorkspaceEditInputError';
  }
}

export type PostEditDiagnosticEvidence =
  | { status: 'snapshot'; snapshot: DiagnosticSnapshot }
  | { status: 'unavailable' };

export interface WorkspaceMutationToolResult<T> {
  edit: T;
  diagnostics: PostEditDiagnosticEvidence;
}

export type WorkspaceEditToolResult = WorkspaceMutationToolResult<WorkspaceTextReplacementResult>;
export type WorkspaceFileCreationToolResult = WorkspaceMutationToolResult<WorkspaceTextFileCreationResult>;

export class WorkspaceEditService {
  private readonly agentCreatedFiles = new Set<string>();

  constructor(
    private readonly files: WorkspaceWritePort,
    private readonly diagnostics?: DiagnosticProvider
  ) {}

  async replaceText(input: unknown, signal: AbortSignal): Promise<WorkspaceEditToolResult> {
    const edit = await this.files.replaceText(parseReplacement(input), signal);
    return this.withDiagnostics(edit, signal);
  }

  async createTextFile(input: unknown, signal: AbortSignal): Promise<WorkspaceFileCreationToolResult> {
    const creation = parseCreation(input);
    const edit = await this.files.createTextFile(creation, signal);
    // Whole-file rewrites later in the same run are restricted to paths the
    // agent itself created, so a model never silently clobbers user files.
    this.agentCreatedFiles.add(edit.path);
    return this.withDiagnostics(edit, signal);
  }

  async rewriteTextFile(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceTextFileRewriteResult>> {
    const rewrite = parseRewrite(input);
    if (!this.agentCreatedFiles.has(rewrite.path)) {
      throw new WorkspaceEditInputError('Whole-file rewrites are only allowed for files created by the agent in this run; use replace_text for other files.');
    }
    const edit = await this.files.rewriteTextFile(rewrite, signal);
    return this.withDiagnostics(edit, signal);
  }

  async deleteFile(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceFileDeletionResult>> {
    const deletion = parseDeletion(input);
    const edit = await this.files.deleteFile(deletion, signal);
    this.agentCreatedFiles.delete(edit.path);
    return this.withDiagnostics(edit, signal);
  }

  async renameFile(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceFileRenameResult>> {
    const rename = parseRename(input);
    const edit = await this.files.renameFile(rename, signal);
    if (this.agentCreatedFiles.has(edit.fromPath)) {
      this.agentCreatedFiles.delete(edit.fromPath);
      this.agentCreatedFiles.add(edit.toPath);
    }
    return this.withDiagnostics(edit, signal);
  }

  async createDirectory(input: unknown, signal: AbortSignal): Promise<WorkspaceMutationToolResult<WorkspaceDirectoryCreationResult>> {
    const creation = parseDirectoryCreation(input);
    const edit = await this.files.createDirectory(creation, signal);
    return this.withDiagnostics(edit, signal);
  }

  private async withDiagnostics<T>(edit: T, signal: AbortSignal): Promise<WorkspaceMutationToolResult<T>> {
    return { edit, diagnostics: await this.readDiagnosticsAfterMutation(signal) };
  }

  private async readDiagnosticsAfterMutation(signal: AbortSignal): Promise<PostEditDiagnosticEvidence> {
    if (!this.diagnostics || signal.aborted) return { status: 'unavailable' };
    try {
      const snapshot = await this.diagnostics.read(signal);
      return snapshot.available
        ? { status: 'snapshot', snapshot: structuredClone(snapshot) }
        : { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  }
}

export function createWorkspaceEditTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'replace_text',
    description: 'Replace exactly one occurrence in an existing UTF-8 workspace file. First read the file and pass its sha256 as expectedSha256.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        oldText: { type: 'string', minLength: 1, maxLength: MAX_REPLACEMENT_CHARACTERS },
        newText: { type: 'string', maxLength: MAX_REPLACEMENT_CHARACTERS }
      },
      required: ['path', 'expectedSha256', 'oldText', 'newText'],
      additionalProperties: false
    },
    execute: (input, context) => service.replaceText(input, context.signal)
  };
}

export function createWorkspaceFileTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'create_text_file',
    description: 'Create one new UTF-8 file in an existing workspace directory. This never overwrites an existing path.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        content: { type: 'string', maxLength: MAX_NEW_FILE_CHARACTERS }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    execute: (input, context) => service.createTextFile(input, context.signal)
  };
}

export function createWorkspaceRewriteTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'rewrite_text_file',
    description:
      'Replace the whole content of a file the agent created earlier in this run via create_text_file '
      + '(newly created test/doc files, follow-ups, fixes). Pass the current sha256 from read_file. '
      + 'For other files use replace_text with the exact old fragment.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        content: { type: 'string', maxLength: MAX_NEW_FILE_CHARACTERS }
      },
      required: ['path', 'expectedSha256', 'content'],
      additionalProperties: false
    },
    execute: (input, context) => service.rewriteTextFile(input, context.signal)
  };
}

export function createWorkspaceDeleteTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'delete_file',
    description:
      'Delete one regular UTF-8 text file inside the workspace. Never deletes directories; '
      + 'credential-sensitive paths are rejected. The agent may not delete through symbolic links.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: (input, context) => service.deleteFile(input, context.signal)
  };
}

export function createWorkspaceRenameTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'rename_file',
    description:
      'Rename or move one file to another workspace-relative path. Never overwrites an existing target. '
      + 'Useful before replacing stale generated files or reorganizing agent-created tests.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        fromPath: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        toPath: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['fromPath', 'toPath'],
      additionalProperties: false
    },
    execute: (input, context) => service.renameFile(input, context.signal)
  };
}

export function createWorkspaceDirectoryTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'create_directory',
    description: 'Create one directory (and any missing parents) inside the workspace, e.g. a tests/ folder.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: (input, context) => service.createDirectory(input, context.signal)
  };
}

function parseReplacement(value: unknown): WorkspaceTextReplacement {
  if (!isExactRecord(value, ['path', 'expectedSha256', 'oldText', 'newText'])) {
    throw new WorkspaceEditInputError();
  }
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.expectedSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
    || !isBoundedNonEmpty(value.oldText, MAX_REPLACEMENT_CHARACTERS)
    || typeof value.newText !== 'string'
    || value.newText.length > MAX_REPLACEMENT_CHARACTERS
    || value.newText.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return {
    path: value.path.trim(),
    expectedSha256: value.expectedSha256,
    oldText: value.oldText,
    newText: value.newText
  };
}

function parseCreation(value: unknown): WorkspaceTextFileCreation {
  if (!isExactRecord(value, ['path', 'content'])) throw new WorkspaceEditInputError();
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.content !== 'string'
    || value.content.length > MAX_NEW_FILE_CHARACTERS
    || value.content.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return { path: value.path.trim(), content: value.content };
}

function parseRewrite(value: unknown): WorkspaceTextFileRewrite {
  if (!isExactRecord(value, ['path', 'expectedSha256', 'content'])) throw new WorkspaceEditInputError();
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.expectedSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
    || typeof value.content !== 'string'
    || value.content.length > MAX_NEW_FILE_CHARACTERS
    || value.content.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return { path: value.path.trim(), expectedSha256: value.expectedSha256, content: value.content };
}

function parseDeletion(value: unknown): WorkspaceFileDeletion {
  if (!isExactRecord(value, ['path'])) throw new WorkspaceEditInputError();
  if (!isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)) throw new WorkspaceEditInputError();
  return { path: value.path.trim() };
}

function parseRename(value: unknown): WorkspaceFileRename {
  if (!isExactRecord(value, ['fromPath', 'toPath'])) throw new WorkspaceEditInputError();
  if (
    !isBoundedNonBlank(value.fromPath, MAX_PATH_CHARACTERS)
    || !isBoundedNonBlank(value.toPath, MAX_PATH_CHARACTERS)
  ) {
    throw new WorkspaceEditInputError();
  }
  return { fromPath: value.fromPath.trim(), toPath: value.toPath.trim() };
}

function parseDirectoryCreation(value: unknown): WorkspaceDirectoryCreation {
  if (!isExactRecord(value, ['path'])) throw new WorkspaceEditInputError();
  if (!isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)) throw new WorkspaceEditInputError();
  return { path: value.path.trim() };
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedNonBlank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function isBoundedNonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}
