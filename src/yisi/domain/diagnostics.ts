export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface DiagnosticPosition {
  line: number;
  character: number;
}

export interface DiagnosticItem {
  uri: string;
  range: { start: DiagnosticPosition; end: DiagnosticPosition };
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string;
}

export interface DiagnosticCounts {
  error: number;
  warning: number;
  information: number;
  hint: number;
}

export interface DiagnosticSnapshot {
  available: boolean;
  items: DiagnosticItem[];
  total: number;
  truncated: boolean;
  counts: DiagnosticCounts;
}

export interface DiagnosticProvider {
  read(signal: AbortSignal): Promise<DiagnosticSnapshot>;
}
