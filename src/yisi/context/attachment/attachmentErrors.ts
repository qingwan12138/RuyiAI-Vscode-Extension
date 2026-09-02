// Attachment-specific error, shared by the domain/application/infrastructure
// layers. An attachment failure must never surface as the generic "session
// action failed" path: the attachment service catches this and reports a
// per-attachment status back to the composer instead.

export class AttachmentExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AttachmentExtractionError';
  }
}
