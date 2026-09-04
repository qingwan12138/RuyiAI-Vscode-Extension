// VS Code DocumentSymbol adapter for the read-only list_symbols tool (C1).
// Maps language-server symbol trees into the neutral application model; no
// prompt or tool logic lives here.

import * as vscode from 'vscode';
import { DocumentSymbolProvider } from '../../application/context/symbolLookupService';
import { SymbolNode } from '../../application/context/symbolIndex';

export class VsCodeDocumentSymbolProvider implements DocumentSymbolProvider {
  async getSymbols(absolutePath: string): Promise<SymbolNode[]> {
    const uri = vscode.Uri.file(absolutePath);
    const result = await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined
    >('vscode.executeDocumentSymbolProvider', uri);
    if (!result) return [];
    return result.map(convert).filter((node): node is SymbolNode => node !== undefined);
  }
}

function convert(
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation
): SymbolNode | undefined {
  if (isDocumentSymbol(symbol)) {
    return {
      name: symbol.name,
      kindLabel: symbolKindLabel(symbol.kind),
      lineStart: symbol.range.start.line + 1,
      lineEnd: symbol.range.end.line + 1,
      ...(symbol.detail ? { detail: symbol.detail } : {}),
      ...(symbol.children.length > 0
        ? { children: symbol.children.map(child => convert(child)).filter((node): node is SymbolNode => node !== undefined) }
        : {})
    };
  }
  // SymbolInformation (flat) fallback for providers without hierarchy.
  return {
    name: symbol.name,
    kindLabel: symbolKindLabel(symbol.kind),
    lineStart: symbol.location.range.start.line + 1,
    lineEnd: symbol.location.range.end.line + 1,
    ...(symbol.containerName ? { detail: symbol.containerName } : {})
  };
}

function isDocumentSymbol(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): symbol is vscode.DocumentSymbol {
  return Array.isArray((symbol as vscode.DocumentSymbol).children);
}

const SYMBOL_KIND_LABELS: Record<number, string> = {};
SYMBOL_KIND_LABELS[vscode.SymbolKind.File] = 'file';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Module] = 'module';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Namespace] = 'namespace';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Package] = 'package';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Class] = 'class';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Method] = 'method';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Property] = 'property';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Field] = 'field';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Constructor] = 'constructor';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Enum] = 'enum';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Interface] = 'interface';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Function] = 'function';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Variable] = 'variable';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Constant] = 'constant';
SYMBOL_KIND_LABELS[vscode.SymbolKind.String] = 'string';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Number] = 'number';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Boolean] = 'boolean';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Array] = 'array';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Object] = 'object';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Key] = 'key';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Null] = 'null';
SYMBOL_KIND_LABELS[vscode.SymbolKind.EnumMember] = 'enum-member';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Struct] = 'struct';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Event] = 'event';
SYMBOL_KIND_LABELS[vscode.SymbolKind.Operator] = 'operator';
SYMBOL_KIND_LABELS[vscode.SymbolKind.TypeParameter] = 'type-parameter';

function symbolKindLabel(kind: vscode.SymbolKind): string {
  return SYMBOL_KIND_LABELS[kind] ?? 'symbol';
}
