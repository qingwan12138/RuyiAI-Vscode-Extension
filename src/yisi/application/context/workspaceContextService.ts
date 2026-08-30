import { FileSystemPort, WorkspaceDirectoryEntry, WorkspaceFileContent, WorkspaceSearchResult } from '../../context/workspaceContext';
import { YisiTool } from '../../domain/tool';
import { isImplicitlySensitivePath } from '../../context/implicitSensitivePath';

export interface ReadFileInput { path: string }
export interface ListDirectoryInput { path: string }
export interface SearchTextInput { query: string; scope?: string }

export class WorkspaceContextInputError extends Error {
  constructor(message = 'Invalid workspace context input.') {
    super(message);
    this.name = 'WorkspaceContextInputError';
  }
}

export class WorkspaceContextService {
  constructor(private readonly fileSystem: FileSystemPort) {}

  readFile(input: ReadFileInput, signal?: AbortSignal): Promise<WorkspaceFileContent> {
    return this.fileSystem.readFile(normalizePath(input.path), signal);
  }

  listDirectory(input: ListDirectoryInput, signal?: AbortSignal): Promise<WorkspaceDirectoryEntry[]> {
    return this.fileSystem.listDirectory(normalizePath(input.path), signal);
  }

  searchText(input: SearchTextInput, signal?: AbortSignal): Promise<WorkspaceSearchResult> {
    const query = normalizeText(input.query, 'Search query', 1_000);
    const scope = input.scope === undefined ? '.' : normalizePath(input.scope);
    return this.fileSystem.searchText(query, scope, signal);
  }
}

export function createWorkspaceContextTools(service: WorkspaceContextService): YisiTool[] {
  return [
    {
      id: 'read_file',
      description: 'Read one UTF-8 text file within the active workspace.',
      risk: 'readOnly',
      mutatesWorkspace: false,
      supportsCancellation: true,
      inputSchema: objectSchema({ path: stringSchema('Workspace-relative file path') }, ['path']),
      execute: async (input, context) => service.readFile(parseAgentReadInput(input), context.signal)
    },
    {
      id: 'list_directory',
      description: 'List the immediate entries of one directory within the active workspace.',
      risk: 'readOnly',
      mutatesWorkspace: false,
      supportsCancellation: true,
      inputSchema: objectSchema({ path: stringSchema('Workspace-relative directory path') }, ['path']),
      execute: async (input, context) => service.listDirectory(parsePathInput(input), context.signal)
    },
    {
      id: 'search_text',
      description: 'Search for literal UTF-8 text within a bounded workspace directory scope.',
      risk: 'readOnly',
      mutatesWorkspace: false,
      supportsCancellation: true,
      inputSchema: objectSchema({
        query: stringSchema('Literal text to find'),
        scope: stringSchema('Optional workspace-relative directory scope')
      }, ['query']),
      execute: async (input, context) => service.searchText(parseSearchInput(input), context.signal)
    }
  ];
}

function parsePathInput(value: unknown): ReadFileInput {
  if (!isRecord(value) || !hasExactKeys(value, ['path']) || typeof value.path !== 'string') throw new WorkspaceContextInputError();
  return { path: normalizePath(value.path) };
}

function parseAgentReadInput(value: unknown): ReadFileInput {
  const input = parsePathInput(value);
  if (isImplicitlySensitivePath(input.path)) {
    throw new WorkspaceContextInputError('Implicit Agent reads of credential-sensitive files are blocked.');
  }
  return input;
}

function parseSearchInput(value: unknown): SearchTextInput {
  if (!isRecord(value) || typeof value.query !== 'string') throw new WorkspaceContextInputError();
  const keys = value.scope === undefined ? ['query'] : ['query', 'scope'];
  if (!hasExactKeys(value, keys) || (value.scope !== undefined && typeof value.scope !== 'string')) {
    throw new WorkspaceContextInputError();
  }
  const query = normalizeText(value.query, 'Search query', 1_000);
  return value.scope === undefined
    ? { query }
    : { query, scope: normalizePath(value.scope) };
}

function normalizePath(value: string): string {
  return normalizeText(value, 'Workspace path', 4_096);
}

function normalizeText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes('\0')) {
    throw new WorkspaceContextInputError(`${label} is invalid.`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function stringSchema(description: string): Readonly<Record<string, unknown>> {
  return { type: 'string', minLength: 1, description };
}

function objectSchema(
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  required: string[]
): Readonly<Record<string, unknown>> {
  return { type: 'object', properties, required, additionalProperties: false };
}
