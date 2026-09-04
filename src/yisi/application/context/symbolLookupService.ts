// Symbol lookup service + read-only agent tool (C1).
//
// The agent can ask for the language-server symbol index of one workspace file
// before reading/editing it — much cheaper than reading the whole file when it
// only needs to locate definitions. Resolution stays workspace-relative and the
// provider (vscode DocumentSymbol adapter) is injected so this layer is testable
// without vscode.

import * as path from 'node:path';
import { YisiTool } from '../../domain/tool';
import { flattenSymbols, SymbolIndex, SymbolNode, DEFAULT_SYMBOL_INDEX_LIMIT } from './symbolIndex';

export interface DocumentSymbolProvider {
  getSymbols(absolutePath: string, signal?: AbortSignal): Promise<SymbolNode[]>;
}

export interface SymbolLookupResult extends SymbolIndex {
  path: string;
  /** Present when the language server reported nothing for the file. */
  note?: string;
}

export class SymbolInputError extends Error {
  constructor(message = 'Invalid symbol lookup input.') {
    super(message);
    this.name = 'SymbolInputError';
  }
}

const MAX_PATH_CHARACTERS = 4_096;

export class SymbolLookupService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly provider: DocumentSymbolProvider
  ) {}

  async listSymbols(input: unknown, signal?: AbortSignal): Promise<SymbolLookupResult> {
    const relativePath = parseSymbolPath(input);
    const absolutePath = resolveInsideWorkspace(this.workspaceRoot, relativePath);
    let nodes: SymbolNode[];
    try {
      nodes = await this.provider.getSymbols(absolutePath, signal);
    } catch (error) {
      throw new SymbolInputError(`Symbol lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const index = flattenSymbols(nodes, DEFAULT_SYMBOL_INDEX_LIMIT);
    return {
      path: relativePath,
      items: index.items,
      total: index.total,
      truncated: index.truncated,
      ...(index.items.length === 0
        ? { note: 'No symbols reported by the language server for this file. The file may be unsaved/closed, binary, or its language extension may be inactive.' }
        : {})
    };
  }
}

export function createListSymbolsTool(service: SymbolLookupService): YisiTool {
  return {
    id: 'list_symbols',
    description:
      'List the symbols (functions/classes/methods/variables…) the language server reports for one '
      + 'workspace-relative file, with kinds and 1-based line ranges. Call it before reading or editing a '
      + 'file when you need to locate definitions or API surface. Read-only.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: (input, context) => service.listSymbols(input, context.signal)
  };
}

export function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new SymbolInputError('Symbol lookup path must stay inside the workspace.');
  }
  return resolved;
}

function parseSymbolPath(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.path !== 'string') {
    throw new SymbolInputError();
  }
  const trimmed = value.path.trim();
  if (
    !trimmed
    || trimmed.length > MAX_PATH_CHARACTERS
    || trimmed.includes('\0')
    || path.isAbsolute(trimmed)
    || path.win32.isAbsolute(trimmed)
    || path.posix.isAbsolute(trimmed)
    || trimmed.endsWith('/')
    || trimmed.endsWith('\\')
  ) {
    throw new SymbolInputError('A non-empty workspace-relative file path is required.');
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
