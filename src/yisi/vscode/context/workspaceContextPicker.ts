import * as path from 'node:path';
import * as vscode from 'vscode';
import { AttachmentContextPicker } from '../../application/context/explicitContextPicker';
import { AttachmentService, AttachmentOutcome, AttachmentCandidate } from '../../application/attachment/attachmentService';
import { ATTACHMENT_LIMITS } from '../../context/attachment/attachmentTypes';
import { classifyByExtension } from '../../context/attachment/attachmentKind';
import { isImplicitlySensitivePath } from '../../context/implicitSensitivePath';
import { NodeWorkspaceFileSystem, readExternalFileBytes, WorkspaceLimitError } from '../../infrastructure/context/nodeWorkspaceFileSystem';

// The "supported" filters list only formats a real extractor can turn into
// context. Legacy formats with no safe, maintained, pure-JS reader (.doc, .odt,
// .rtf, .ppt, .odp, .xls, .ods) are intentionally absent: they can still be
// picked via "All Files" and then receive an explicit "unsupported" chip.
const OPEN_FILTERS: Record<string, string[]> = {
  'All Supported Files': [
    'txt', 'md', 'log', 'rst', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'html', 'htm', 'css', 'sql', 'svg',
    'ts', 'tsx', 'js', 'jsx', 'py', 'c', 'h', 'cpp', 'rs', 'go', 'java', 'cs', 'swift', 'php', 'rb', 'sh', 'ps1', 'lua', 'tex',
    'pdf', 'docx', 'xlsx', 'csv', 'tsv', 'pptx', 'ipynb',
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'
  ],
  'Code': ['ts', 'tsx', 'js', 'jsx', 'py', 'c', 'h', 'cpp', 'cc', 'rs', 'go', 'java', 'kt', 'cs', 'swift', 'php', 'rb', 'sh', 'ps1', 'lua', 'tex'],
  'Documents': ['pdf', 'docx', 'md', 'txt', 'html'],
  'Spreadsheets': ['xlsx', 'csv', 'tsv'],
  'Notebooks': ['ipynb'],
  'Images': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  'All Files': ['*']
};

export class VsCodeWorkspaceContextPicker implements AttachmentContextPicker {
  private readonly fileSystems = new Map<string, Promise<NodeWorkspaceFileSystem>>();

  constructor(private readonly attachments: AttachmentService) {}

  async pickAttachments(signal?: AbortSignal): Promise<AttachmentOutcome[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage('Open a local workspace folder before attaching file context.');
      return [];
    }
    const picked = await vscode.window.showOpenDialog({
      title: 'Yisi AI · Attach files',
      defaultUri: folders[0].uri,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: 'Attach',
      filters: OPEN_FILTERS
    });
    if (!picked || picked.length === 0) return [];
    signal?.throwIfAborted();

    const outcomes: AttachmentOutcome[] = [];
    for (const uri of picked) {
      signal?.throwIfAborted();
      if (uri.scheme !== 'file') {
        void vscode.window.showWarningMessage('Yisi AI can only attach local files.');
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const name = path.basename(uri.fsPath);
      // Extension-based kind used only for read failures (e.g. an oversized PDF
      // the reader rejected at maxReadBytes) so the chip still names the real
      // type instead of a generic BIN.
      const kindHint = classifyByExtension(name)?.kind ?? 'unsupported';
      const isExternal = !folder || folder.uri.scheme !== 'file';

      if (isExternal) {
        // A user explicitly picking a file outside the workspace is granting
        // read-only access to that single file. It is context only — the agent's
        // workspace tools reject absolute paths, so it can never be edited.
        const absolutePath = uri.fsPath;
        const meta = { name, relativePath: absolutePath, location: 'external' as const, uri: uri.toString() };
        if (isImplicitlySensitivePath(name)) {
          const choice = await vscode.window.showWarningMessage(
            `"${name}" may contain sensitive information (such as keys or credentials). Attach anyway?`,
            { modal: true },
            'Attach',
            'Skip'
          );
          if (choice !== 'Attach') continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = await readExternalFileBytes(absolutePath, signal, ATTACHMENT_LIMITS.maxReadBytes);
        } catch (error) {
          const message = error instanceof WorkspaceLimitError
            ? `This file is too large to attach (limit ${formatMb(ATTACHMENT_LIMITS.maxReadBytes)}).`
            : 'This file could not be read.';
          outcomes.push(this.attachments.createFailure(meta, message, kindHint));
          continue;
        }
        const candidate: AttachmentCandidate = {
          name,
          relativePath: absolutePath,
          location: 'external',
          uri: uri.toString(),
          bytes
        };
        outcomes.push(await this.attachments.attachOne(candidate));
        continue;
      }

      const relativePath = toPosix(path.relative(folder.uri.fsPath, uri.fsPath));
      const workspaceFolderUri = folder.uri.toString();
      const meta = { name, relativePath, workspaceFolderUri, location: 'workspace' as const };

      if (isImplicitlySensitivePath(relativePath)) {
        const choice = await vscode.window.showWarningMessage(
          `"${name}" may contain sensitive information (such as keys or credentials). Attach anyway?`,
          { modal: true },
          'Attach',
          'Skip'
        );
        if (choice !== 'Attach') continue;
      }

      let bytes: Uint8Array;
      try {
        const fileSystem = await this.fileSystemFor(folder);
        bytes = await fileSystem.readFileBytes(relativePath, signal, ATTACHMENT_LIMITS.maxReadBytes);
      } catch (error) {
        const message = error instanceof WorkspaceLimitError
          ? `This file is too large to attach (limit ${formatMb(ATTACHMENT_LIMITS.maxReadBytes)}).`
          : 'This file could not be read from the workspace.';
        outcomes.push(this.attachments.createFailure(meta, message, kindHint));
        continue;
      }

      const candidate: AttachmentCandidate = {
        name,
        relativePath,
        workspaceFolderUri,
        location: 'workspace',
        bytes
      };
      outcomes.push(await this.attachments.attachOne(candidate));
    }
    return outcomes;
  }

  private fileSystemFor(folder: vscode.WorkspaceFolder): Promise<NodeWorkspaceFileSystem> {
    const key = folder.uri.toString();
    let fileSystem = this.fileSystems.get(key);
    if (!fileSystem) {
      fileSystem = NodeWorkspaceFileSystem.create(folder.uri.fsPath);
      this.fileSystems.set(key, fileSystem);
    }
    return fileSystem;
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
