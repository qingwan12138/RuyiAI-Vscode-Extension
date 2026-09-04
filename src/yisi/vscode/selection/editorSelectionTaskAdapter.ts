// VS Code adapter for editor selection tasks. This file is the only place that
// knows how to turn the current active editor + selection into the pure
// {@link EditorSelectionTaskContext} consumed by the chat layer. No prompt
// wording lives here.

import * as vscode from 'vscode';
import * as path from 'node:path';
import { EditorSelectionTaskContext } from '../../application/chat/editorSelectionTask';

/**
 * Collect the active editor selection as a task context.
 * Returns undefined when there is no active text editor or no non-empty
 * selection; the caller then asks the user to select code first.
 */
export function collectActiveEditorSelection(): EditorSelectionTaskContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selection = editor.selection;
  if (!selection || selection.isEmpty) return undefined;
  const document = editor.document;
  const code = document.getText(selection);
  if (!code.trim()) return undefined;

  return {
    fileName: describeFile(document.uri),
    languageId: document.languageId && document.languageId.trim()
      ? document.languageId
      : 'plaintext',
    lineStart: selection.start.line + 1,
    lineEnd: selection.end.line + 1,
    code
  };
}

/** Workspace-relative path when the file lives in a workspace folder, else basename. */
function describeFile(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  }
  return path.basename(uri.fsPath);
}
