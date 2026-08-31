import {
  DiagnosticCounts,
  DiagnosticItem,
  DiagnosticProvider,
  DiagnosticSeverity,
  DiagnosticSnapshot
} from '../../domain/diagnostics';
import { isImplicitlySensitivePath } from '../../context/implicitSensitivePath';

interface UriLike {
  toString(): string;
}

interface PositionLike {
  line: number;
  character: number;
}

interface DiagnosticLike {
  range: { start: PositionLike; end: PositionLike };
  message: string;
  severity: number;
  source?: string;
  code?: string | number | { value: string | number };
}

export interface VsCodeDiagnosticsFacade {
  getDiagnostics(): ReadonlyArray<readonly [UriLike, readonly DiagnosticLike[]]>;
  getWorkspaceFolder(uri: UriLike): { uri: UriLike } | undefined;
}

const emptyCounts = (): DiagnosticCounts => ({ error: 0, warning: 0, information: 0, hint: 0 });

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
}

function severityOf(value: number): DiagnosticSeverity {
  if (value === 0) return 'error';
  if (value === 1) return 'warning';
  if (value === 2) return 'information';
  return 'hint';
}

function codeOf(code: DiagnosticLike['code']): string | undefined {
  if (code === undefined) return undefined;
  if (typeof code === 'object') return String(code.value);
  return String(code);
}

function compareDiagnostics(left: DiagnosticItem, right: DiagnosticItem): number {
  return left.uri.localeCompare(right.uri) ||
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.severity.localeCompare(right.severity) ||
    left.message.localeCompare(right.message);
}

export class VsCodeDiagnosticProvider implements DiagnosticProvider {
  private readonly allowedWorkspaceUris: Set<string>;

  constructor(
    private readonly facade: VsCodeDiagnosticsFacade,
    workspaceUris: readonly string[],
    private readonly maxItems = 2_000
  ) {
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new Error('Diagnostic item limit must be a positive integer.');
    }
    this.allowedWorkspaceUris = new Set(workspaceUris);
  }

  async read(signal: AbortSignal): Promise<DiagnosticSnapshot> {
    abortIfRequested(signal);
    const counts = emptyCounts();
    if (this.allowedWorkspaceUris.size === 0) {
      return { available: false, items: [], total: 0, truncated: false, counts };
    }

    const items: DiagnosticItem[] = [];
    for (const [uri, diagnostics] of this.facade.getDiagnostics()) {
      abortIfRequested(signal);
      if (isSensitiveUri(uri.toString())) continue;
      const folder = this.facade.getWorkspaceFolder(uri);
      if (!folder || !this.allowedWorkspaceUris.has(folder.uri.toString())) continue;
      for (const diagnostic of diagnostics) {
        abortIfRequested(signal);
        const severity = severityOf(diagnostic.severity);
        counts[severity] += 1;
        items.push({
          uri: uri.toString(),
          range: {
            start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
            end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character }
          },
          severity,
          message: diagnostic.message,
          ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
          ...(diagnostic.code === undefined ? {} : { code: codeOf(diagnostic.code) })
        });
      }
    }
    items.sort(compareDiagnostics);
    const total = items.length;
    return {
      available: true,
      items: items.slice(0, this.maxItems),
      total,
      truncated: total > this.maxItems,
      counts
    };
  }
}

function isSensitiveUri(value: string): boolean {
  try {
    return isImplicitlySensitivePath(decodeURIComponent(new URL(value).pathname));
  } catch {
    return true;
  }
}
