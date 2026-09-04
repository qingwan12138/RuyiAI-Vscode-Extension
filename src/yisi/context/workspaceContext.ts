export type WorkspaceEntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface WorkspaceFileContent {
  path: string;
  text: string;
  bytes: number;
  sha256: string;
}

export interface WorkspaceTextReplacement {
  path: string;
  expectedSha256: string;
  oldText: string;
  newText: string;
}

export interface WorkspaceTextReplacementResult {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  replacements: 1;
  bytes: number;
}

export interface WorkspaceTextFileCreation {
  path: string;
  content: string;
}

export interface WorkspaceTextFileCreationResult {
  path: string;
  sha256: string;
  bytes: number;
}

export interface WorkspaceTextFileRewrite {
  path: string;
  expectedSha256: string;
  content: string;
}

export interface WorkspaceTextFileRewriteResult {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  bytes: number;
}

export interface WorkspaceFileDeletion {
  path: string;
}

export interface WorkspaceFileDeletionResult {
  path: string;
  beforeSha256: string;
  bytes: number;
}

export interface WorkspaceFileRename {
  fromPath: string;
  toPath: string;
}

export interface WorkspaceFileRenameResult {
  fromPath: string;
  toPath: string;
}

export interface WorkspaceDirectoryCreation {
  path: string;
}

export interface WorkspaceDirectoryCreationResult {
  path: string;
  created: boolean;
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

export interface WorkspaceWritePort {
  replaceText(change: WorkspaceTextReplacement, signal?: AbortSignal): Promise<WorkspaceTextReplacementResult>;
  createTextFile(change: WorkspaceTextFileCreation, signal?: AbortSignal): Promise<WorkspaceTextFileCreationResult>;
  rewriteTextFile(change: WorkspaceTextFileRewrite, signal?: AbortSignal): Promise<WorkspaceTextFileRewriteResult>;
  deleteFile(change: WorkspaceFileDeletion, signal?: AbortSignal): Promise<WorkspaceFileDeletionResult>;
  renameFile(change: WorkspaceFileRename, signal?: AbortSignal): Promise<WorkspaceFileRenameResult>;
  createDirectory(change: WorkspaceDirectoryCreation, signal?: AbortSignal): Promise<WorkspaceDirectoryCreationResult>;
}
