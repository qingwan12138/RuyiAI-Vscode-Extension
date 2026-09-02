import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  FileSystemPort,
  WorkspaceContextLimits,
  WorkspaceDirectoryEntry,
  WorkspaceEntryKind,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
  WorkspaceTextFileCreation,
  WorkspaceTextFileCreationResult,
  WorkspaceTextReplacement,
  WorkspaceTextReplacementResult,
  WorkspaceWritePort
} from '../../context/workspaceContext';
import { isImplicitlySensitivePath } from '../../context/implicitSensitivePath';

const DEFAULT_LIMITS: WorkspaceContextLimits = {
  maxReadBytes: 1024 * 1024,
  maxDirectoryEntries: 2_000,
  maxSearchFileBytes: 512 * 1024,
  maxSearchFiles: 5_000,
  maxSearchResults: 200,
  maxSearchMilliseconds: 5_000,
  maxPreviewCharacters: 240
};

const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', '.cache'
]);

export class WorkspaceBoundaryError extends Error {
  constructor(message = 'Path is outside the workspace boundary.') {
    super(message);
    this.name = 'WorkspaceBoundaryError';
  }
}

export class WorkspaceContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceContentError';
  }
}

export class WorkspaceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceLimitError';
  }
}

export class NodeWorkspaceFileSystem implements FileSystemPort, WorkspaceWritePort {
  private constructor(
    private readonly root: string,
    private readonly limits: WorkspaceContextLimits
  ) {}

  static async create(
    workspaceRoot: string,
    limits: Partial<WorkspaceContextLimits> = {}
  ): Promise<NodeWorkspaceFileSystem> {
    const root = await fs.realpath(workspaceRoot);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new WorkspaceContentError('Workspace root is not a directory.');
    return new NodeWorkspaceFileSystem(root, validateLimits({ ...DEFAULT_LIMITS, ...limits }));
  }

  async readFile(relativePath: string, signal?: AbortSignal): Promise<WorkspaceFileContent> {
    signal?.throwIfAborted();
    const target = await this.resolveExisting(relativePath, false);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new WorkspaceContentError('Workspace path is not a file.');
    if (stat.size > this.limits.maxReadBytes) throw new WorkspaceLimitError('Workspace file exceeds the read limit.');
    const bytes = await readBounded(target, this.limits.maxReadBytes, signal);
    return {
      path: this.relative(target),
      text: decodeText(bytes),
      bytes: bytes.byteLength,
      sha256: sha256(bytes)
    };
  }

  async replaceText(
    change: WorkspaceTextReplacement,
    signal?: AbortSignal
  ): Promise<WorkspaceTextReplacementResult> {
    signal?.throwIfAborted();
    if (isImplicitlySensitivePath(change.path)) {
      throw new WorkspaceContentError('Agent edits cannot target credential-sensitive paths.');
    }
    if (!/^[a-f0-9]{64}$/.test(change.expectedSha256)) {
      throw new WorkspaceContentError('Expected file version is invalid.');
    }
    if (!change.oldText) throw new WorkspaceContentError('Replacement source text is required.');
    const target = await this.resolveExisting(change.path, false);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new WorkspaceContentError('Workspace path is not a file.');
    if (stat.size > this.limits.maxReadBytes) throw new WorkspaceLimitError('Workspace file exceeds the edit limit.');
    const originalBytes = await readBounded(target, this.limits.maxReadBytes, signal);
    const beforeSha256 = sha256(originalBytes);
    if (beforeSha256 !== change.expectedSha256) {
      throw new WorkspaceContentError('Workspace file changed since it was read.');
    }
    const original = decodeText(originalBytes);
    if (countOccurrences(original, change.oldText) !== 1) {
      throw new WorkspaceContentError('Replacement source text must occur exactly once.');
    }
    const updated = original.replace(change.oldText, change.newText);
    const updatedBytes = Buffer.from(updated, 'utf8');
    if (updatedBytes.byteLength > this.limits.maxReadBytes) {
      throw new WorkspaceLimitError('Updated workspace file exceeds the edit limit.');
    }
    signal?.throwIfAborted();
    const temporary = path.join(path.dirname(target), `.yisi-edit-${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, stat.mode);
      await handle.writeFile(updatedBytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.chmod(temporary, stat.mode & 0o7777);
      signal?.throwIfAborted();
      await fs.rename(temporary, target);
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
    }
    return {
      path: this.relative(target),
      beforeSha256,
      afterSha256: sha256(updatedBytes),
      replacements: 1,
      bytes: updatedBytes.byteLength
    };
  }

  async createTextFile(
    change: WorkspaceTextFileCreation,
    signal?: AbortSignal
  ): Promise<WorkspaceTextFileCreationResult> {
    signal?.throwIfAborted();
    if (isImplicitlySensitivePath(change.path)) {
      throw new WorkspaceContentError('Agent file creation cannot target credential-sensitive paths.');
    }
    if (change.content.includes('\0')) throw new WorkspaceContentError('Binary workspace content is not supported.');
    const content = Buffer.from(change.content, 'utf8');
    if (content.byteLength > this.limits.maxReadBytes) {
      throw new WorkspaceLimitError('New workspace file exceeds the content limit.');
    }
    const target = await this.resolveNewFile(change.path);
    const temporary = path.join(path.dirname(target), `.yisi-create-${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o666);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
      handle = undefined;
      signal?.throwIfAborted();
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if (hasCode(error, 'EEXIST')) throw new WorkspaceContentError('Workspace target already exists.');
        throw error;
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
    }
    return { path: this.relative(target), sha256: sha256(content), bytes: content.byteLength };
  }

  /**
   * Raw file bytes for the attachment pipeline, without the UTF-8 text decoding
   * that {@link readFile} applies. Containment, symlink realpath and size checks
   * are identical to readFile so attachments cannot escape the workspace.
   */
  async readFileBytes(
    relativePath: string,
    signal?: AbortSignal,
    limitBytes = 8 * 1024 * 1024
  ): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const target = await this.resolveExisting(relativePath, false);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new WorkspaceContentError('Workspace path is not a file.');
    if (stat.size > limitBytes) throw new WorkspaceLimitError('Workspace file exceeds the attachment size limit.');
    return readBounded(target, limitBytes, signal);
  }

  async listDirectory(relativePath: string, signal?: AbortSignal): Promise<WorkspaceDirectoryEntry[]> {
    signal?.throwIfAborted();
    const target = await this.resolveExisting(relativePath, true);
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) throw new WorkspaceContentError('Workspace path is not a directory.');
    const entries = await fs.readdir(target, { withFileTypes: true });
    if (entries.length > this.limits.maxDirectoryEntries) {
      throw new WorkspaceLimitError('Workspace directory exceeds the listing limit.');
    }
    signal?.throwIfAborted();
    return entries
      .sort((left, right) => compareNames(left.name, right.name))
      .map(entry => ({
        path: this.relative(path.join(target, entry.name)),
        name: entry.name,
        kind: entryKind(entry)
      }));
  }

  async searchText(
    query: string,
    relativeScope = '.',
    signal?: AbortSignal
  ): Promise<WorkspaceSearchResult> {
    if (!query) throw new WorkspaceContentError('Search query is required.');
    signal?.throwIfAborted();
    const scope = await this.resolveExisting(relativeScope, true);
    const scopeStat = await fs.stat(scope);
    if (!scopeStat.isDirectory()) throw new WorkspaceContentError('Search scope is not a directory.');

    const startedAt = Date.now();
    const matches: WorkspaceSearchMatch[] = [];
    const directories = [scope];
    const visited = new Set<string>();
    let scannedFiles = 0;
    let truncated = false;

    while (directories.length > 0) {
      signal?.throwIfAborted();
      if (Date.now() - startedAt >= this.limits.maxSearchMilliseconds) {
        truncated = true;
        break;
      }
      const directory = directories.pop()!;
      const canonicalDirectory = await fs.realpath(directory);
      this.assertWithinRoot(canonicalDirectory);
      if (visited.has(canonicalDirectory)) continue;
      visited.add(canonicalDirectory);

      const entries = (await fs.readdir(directory, { withFileTypes: true }))
        .sort((left, right) => compareNames(right.name, left.name));
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (Date.now() - startedAt >= this.limits.maxSearchMilliseconds) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink()) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) directories.push(target);
          continue;
        }
        if (!entry.isFile() || isImplicitlySkippedFile(entry.name)) continue;
        if (scannedFiles >= this.limits.maxSearchFiles) {
          truncated = true;
          break;
        }
        const canonicalTarget = await fs.realpath(target);
        this.assertWithinRoot(canonicalTarget);
        const stat = await fs.stat(canonicalTarget);
        if (stat.size > this.limits.maxSearchFileBytes) continue;
        scannedFiles += 1;
        const bytes = await readBounded(canonicalTarget, this.limits.maxSearchFileBytes, signal);
        let text: string;
        try { text = decodeText(bytes); } catch (error) {
          if (error instanceof WorkspaceContentError) continue;
          throw error;
        }
        const fileMatches = matchLines(this.relative(target), text, query, this.limits.maxPreviewCharacters);
        for (const match of fileMatches) {
          if (matches.length >= this.limits.maxSearchResults) {
            truncated = true;
            break;
          }
          matches.push(match);
        }
        if (truncated) break;
      }
      if (truncated) break;
    }

    return { matches, scannedFiles, truncated };
  }

  private async resolveExisting(relativePath: string, allowRoot: boolean): Promise<string> {
    if (!relativePath || relativePath.includes('\0')) throw new WorkspaceBoundaryError('Workspace-relative path is required.');
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) {
      throw new WorkspaceBoundaryError('Absolute paths are not allowed.');
    }
    const resolved = path.resolve(this.root, relativePath);
    this.assertWithinRoot(resolved, allowRoot);
    const canonical = await fs.realpath(resolved);
    this.assertWithinRoot(canonical, allowRoot);
    return canonical;
  }

  private async resolveNewFile(relativePath: string): Promise<string> {
    if (!relativePath || relativePath.includes('\0')) throw new WorkspaceBoundaryError('Workspace-relative path is required.');
    if (relativePath.endsWith('/') || relativePath.endsWith('\\')) {
      throw new WorkspaceBoundaryError('Workspace file path must not end with a separator.');
    }
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) {
      throw new WorkspaceBoundaryError('Absolute paths are not allowed.');
    }
    const unresolved = path.resolve(this.root, relativePath);
    this.assertWithinRoot(unresolved, false);
    let parent: string;
    try {
      parent = await fs.realpath(path.dirname(unresolved));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) throw new WorkspaceContentError('Workspace parent directory does not exist.');
      throw error;
    }
    this.assertWithinRoot(parent);
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) throw new WorkspaceContentError('Workspace parent path is not a directory.');
    const target = path.join(parent, path.basename(unresolved));
    this.assertWithinRoot(target, false);
    return target;
  }

  private assertWithinRoot(target: string, allowRoot = true): void {
    const relative = path.relative(this.root, target);
    if ((!allowRoot && relative === '') || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new WorkspaceBoundaryError();
    }
  }

  private relative(target: string): string {
    const relative = path.relative(this.root, target);
    this.assertWithinRoot(target);
    return relative.split(path.sep).join('/');
  }
}

/**
 * Reads a single file outside the workspace root by its absolute filesystem
 * path. Used only for user-explicitly-selected external attachments, which are
 * read-only context (the agent's workspace ports reject absolute paths, so these
 * files can never be edited). Same realpath + size guards as readFileBytes,
 * minus the root containment.
 */
export async function readExternalFileBytes(
  absolutePath: string,
  signal?: AbortSignal,
  limitBytes = 8 * 1024 * 1024
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (!absolutePath || absolutePath.includes('\0')) {
    throw new WorkspaceBoundaryError('An absolute file path is required.');
  }
  if (!(path.isAbsolute(absolutePath) || path.win32.isAbsolute(absolutePath) || path.posix.isAbsolute(absolutePath))) {
    throw new WorkspaceBoundaryError('An absolute file path is required.');
  }
  const target = await fs.realpath(absolutePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new WorkspaceContentError('External path is not a file.');
  if (stat.size > limitBytes) throw new WorkspaceLimitError('External file exceeds the attachment size limit.');
  return readBounded(target, limitBytes, signal);
}

async function readBounded(target: string, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const handle = await fs.open(target, constants.O_RDONLY);
  try {
    const buffer = Buffer.allocUnsafe(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    signal?.throwIfAborted();
    if (bytesRead > limit) throw new WorkspaceLimitError('Workspace file exceeds the content limit.');
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new WorkspaceContentError('Binary workspace content is not supported.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new WorkspaceContentError(`Workspace file is not valid UTF-8: ${error instanceof Error ? error.name : 'decode error'}`);
  }
}

function matchLines(pathValue: string, text: string, query: string, previewLimit: number): WorkspaceSearchMatch[] {
  const matches: WorkspaceSearchMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(query);
    if (column >= 0) {
      matches.push({
        path: pathValue,
        line: index + 1,
        column: column + 1,
        preview: lines[index].slice(0, previewLimit)
      });
    }
  }
  return matches;
}

function entryKind(entry: import('node:fs').Dirent): WorkspaceEntryKind {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  if (entry.isSymbolicLink()) return 'symlink';
  return 'other';
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const isImplicitlySkippedFile = isImplicitlySensitivePath;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function countOccurrences(text: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - value.length) {
    const index = text.indexOf(value, offset);
    if (index < 0) break;
    count += 1;
    if (count > 1) break;
    offset = index + value.length;
  }
  return count;
}

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function validateLimits(limits: WorkspaceContextLimits): WorkspaceContextLimits {
  for (const value of Object.values(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new WorkspaceLimitError('Workspace context limits must be positive integers.');
  }
  return { ...limits };
}
