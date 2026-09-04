// Neutral symbol-tree model + pure flattening (C1).
//
// The vscode adapter maps language-server DocumentSymbol trees into this
// dependency-free shape; everything the agent tool needs (bounded flat list,
// line anchors, real total, truncation flag) is computed here so it stays
// unit-testable without the vscode module.

export interface SymbolNode {
  name: string;
  kindLabel: string;
  lineStart: number;
  lineEnd?: number;
  detail?: string;
  children?: SymbolNode[];
}

export interface SymbolInfo {
  name: string;
  kindLabel: string;
  lineStart: number;
  lineEnd?: number;
  detail?: string;
}

export interface SymbolIndex {
  items: SymbolInfo[];
  /** Real total symbol count (children included) before any truncation. */
  total: number;
  truncated: boolean;
}

export const DEFAULT_SYMBOL_INDEX_LIMIT = 400;

/** Depth-first flatten of the symbol tree into a bounded, ordered list. */
export function flattenSymbols(nodes: readonly SymbolNode[], limit = DEFAULT_SYMBOL_INDEX_LIMIT): SymbolIndex {
  const items: SymbolInfo[] = [];
  let truncated = false;
  const visit = (node: SymbolNode): void => {
    if (items.length >= limit) {
      truncated = true;
      return;
    }
    items.push({
      name: node.name,
      kindLabel: node.kindLabel,
      lineStart: node.lineStart,
      ...(node.lineEnd !== undefined ? { lineEnd: node.lineEnd } : {}),
      ...(node.detail !== undefined && node.detail ? { detail: node.detail } : {})
    });
    if (!node.children) return;
    for (const child of node.children) {
      if (items.length >= limit) {
        truncated = true;
        return;
      }
      visit(child);
    }
  };
  for (const node of nodes) {
    if (items.length >= limit) {
      truncated = true;
      break;
    }
    visit(node);
  }
  return { items, total: countSymbols(nodes), truncated };
}

function countSymbols(nodes: readonly SymbolNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.children) count += countSymbols(node.children);
  }
  return count;
}
