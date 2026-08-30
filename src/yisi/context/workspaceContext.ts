export type WorkspaceEntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface WorkspaceFileContent {
  path: string;
  text: string;
  bytes: number;
}

export interface WorkspaceDirectoryEntry {
  path: string;
  name: string;
  kind: WorkspaceEntryKind;
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  scannedFiles: number;
  truncated: boolean;
}

export interface WorkspaceContextLimits {
  maxReadBytes: number;
  maxDirectoryEntries: number;
  maxSearchFileBytes: number;
  maxSearchFiles: number;
  maxSearchResults: number;
  maxSearchMilliseconds: number;
  maxPreviewCharacters: number;
}

export interface FileSystemPort {
  readFile(relativePath: string, signal?: AbortSignal): Promise<WorkspaceFileContent>;
  listDirectory(relativePath: string, signal?: AbortSignal): Promise<WorkspaceDirectoryEntry[]>;
  searchText(query: string, relativeScope?: string, signal?: AbortSignal): Promise<WorkspaceSearchResult>;
}
