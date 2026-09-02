// Minimal ambient declarations for parsing libraries that do not ship their own
// TypeScript types. Only the surface actually used by the attachment extractors
// is declared; xlsx and jszip ship their own types and are imported normally.

declare module 'pdfjs-dist/legacy/build/pdf' {
  export interface PdfTextItem {
    str: string;
    hasEOL?: boolean;
  }
  export interface PdfPageProxy {
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
  }
  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
    destroy(): Promise<void>;
  }
  export interface PdfDocumentLoadingTask {
    promise: Promise<PdfDocumentProxy>;
  }
  export interface GetDocumentParameters {
    data: Uint8Array | ArrayBuffer;
  }
  export function getDocument(source: GetDocumentParameters): PdfDocumentLoadingTask;
  export const GlobalWorkerOptions: { workerSrc: string | null };
}

declare module 'mammoth' {
  export interface RawTextResult {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>;
}
