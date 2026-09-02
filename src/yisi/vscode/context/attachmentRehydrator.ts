import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  AttachmentCandidate,
  AttachmentRehydrator,
  AttachmentService
} from '../../application/attachment/attachmentService';
import { AttachmentContext, ATTACHMENT_LIMITS } from '../../context/attachment/attachmentTypes';
import { FileContextReference } from '../../domain/session';
import { NodeWorkspaceFileSystem, readExternalFileBytes } from '../../infrastructure/context/nodeWorkspaceFileSystem';

/**
 * Re-reads attachment references stored on a session's earlier user messages so
 * the model can keep citing them in later turns. Files are read with the same
 * containment + size guards as the picker; a file that was deleted or moved
 * since attach is silently dropped rather than failing the whole send.
 */
export class VsCodeAttachmentRehydrator implements AttachmentRehydrator {
  private readonly fileSystems = new Map<string, Promise<NodeWorkspaceFileSystem>>();

  constructor(private readonly attachments: AttachmentService) {}

  async rehydrate(reference: FileContextReference, signal?: AbortSignal): Promise<AttachmentContext | undefined> {
    if (reference.type !== 'file') return undefined;

    // External attachments are re-read by absolute path (their persisted `path`
    // is the filesystem path, never a workspace-relative path). A file that was
    // moved or deleted since attach is dropped silently — never a send failure.
    if (reference.location === 'external') {
      const absolutePath = reference.path;
      let bytes: Uint8Array;
      try {
        bytes = await readExternalFileBytes(absolutePath, signal, ATTACHMENT_LIMITS.maxReadBytes);
      } catch {
        console.warn(`[Yisi AI] External attachment "${path.basename(absolutePath)}" is no longer available at its original location.`);
        return undefined;
      }
      const candidate: AttachmentCandidate = {
        name: path.basename(absolutePath),
        relativePath: absolutePath,
        location: 'external',
        uri: reference.uri,
        bytes
      };
      const outcome = await this.attachments.attachOne(candidate);
      return outcome.context?.attachment;
    }

    const folder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.toString() === reference.workspaceFolderUri);
    if (!folder) return undefined;

    let bytes: Uint8Array;
    try {
      const fileSystem = await this.fileSystemFor(folder);
      bytes = await fileSystem.readFileBytes(reference.path, signal, ATTACHMENT_LIMITS.maxReadBytes);
    } catch {
      return undefined;
    }

    const candidate: AttachmentCandidate = {
      name: path.basename(reference.path),
      relativePath: reference.path,
      workspaceFolderUri: reference.workspaceFolderUri,
      location: 'workspace',
      bytes
    };
    const outcome = await this.attachments.attachOne(candidate);
    return outcome.context?.attachment;
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
