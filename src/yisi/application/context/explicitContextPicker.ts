import { AttachmentOutcome } from '../attachment/attachmentService';

/**
 * Port used by the chat host to let the user pick files to attach as context.
 * Implemented in the VS Code layer (dialog + workspace resolution); the picker
 * returns per-file outcomes so one bad file never blocks the others.
 */
export interface AttachmentContextPicker {
  pickAttachments(signal?: AbortSignal): Promise<AttachmentOutcome[]>;
}
