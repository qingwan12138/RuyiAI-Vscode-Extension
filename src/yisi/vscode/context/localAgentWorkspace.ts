interface WorkspaceFolderLike {
  uri: {
    scheme: string;
    fsPath: string;
    toString(): string;
  };
}

export interface LocalAgentWorkspace {
  fsPath: string;
  uri: string;
}

export function selectLocalAgentWorkspace(
  folders: readonly WorkspaceFolderLike[] | undefined
): LocalAgentWorkspace | undefined {
  if (!folders || folders.length !== 1) return undefined;
  const folder = folders[0];
  if (folder.uri.scheme !== 'file' || !folder.uri.fsPath.trim()) return undefined;
  return { fsPath: folder.uri.fsPath, uri: folder.uri.toString() };
}
