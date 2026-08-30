import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExplicitFileContext } from '../../application/chat/chatService';
import { ExplicitContextPicker } from '../../application/context/explicitContextPicker';
import { WorkspaceContextService } from '../../application/context/workspaceContextService';
import { NodeWorkspaceFileSystem } from '../../infrastructure/context/nodeWorkspaceFileSystem';

export class VsCodeWorkspaceContextPicker implements ExplicitContextPicker {
  private readonly services = new Map<string, Promise<WorkspaceContextService>>();

  async pickFile(signal?: AbortSignal): Promise<ExplicitFileContext | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage('Open a local workspace folder before attaching file context.');
      return undefined;
    }
    const picked = await vscode.window.showOpenDialog({
      title: 'Yisi AI · Attach workspace file',
      defaultUri: folders[0].uri,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Attach File'
    });
    if (!picked?.[0]) return undefined;
    signal?.throwIfAborted();
    const uri = picked[0];
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || uri.scheme !== 'file' || folder.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('Yisi AI can only attach a file from the active local workspace.');
      return undefined;
    }
    const relativePath = path.relative(folder.uri.fsPath, uri.fsPath);
    const service = await this.serviceFor(folder);
    const content = await service.readFile({ path: relativePath }, signal);
    return {
      reference: {
        type: 'file',
        path: content.path,
        workspaceFolderUri: folder.uri.toString()
      },
      content: content.text
    };
  }

  private serviceFor(folder: vscode.WorkspaceFolder): Promise<WorkspaceContextService> {
    const key = folder.uri.toString();
    let service = this.services.get(key);
    if (!service) {
      service = NodeWorkspaceFileSystem.create(folder.uri.fsPath).then(port => new WorkspaceContextService(port));
      this.services.set(key, service);
    }
    return service;
  }
}
