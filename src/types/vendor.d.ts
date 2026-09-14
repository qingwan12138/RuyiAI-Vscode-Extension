// Minimal ambient declarations for parsing libraries that do not ship their own
// TypeScript types. Only the surface actually used by the attachment extractors
// is declared; xlsx and jszip ship their own types and are imported normally.
//
// pdfjs is not declared here: it is loaded through the dynamic ESM import in
// infrastructure/attachment/defaultAttachmentRegistry.ts and typed against the
// `PdfJsModule` / `PdfDocumentLike` interfaces in pdfExtractor.ts, which are the
// only pdf.js surface Yisi depends on.

declare module 'mammoth' {
  export interface RawTextResult {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>;
}
