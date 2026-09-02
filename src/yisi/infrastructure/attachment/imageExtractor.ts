// Image extractor. Images are never OCR'd and their bytes are never sent to the
// model as pseudo-text: image attachments are gated on model vision support by
// the attachment service, and this extractor only classifies the format. Until a
// vision-capable model is configured the service surfaces a clear warning and
// keeps the attachment out of context.

import { AttachmentExtractionResult, AttachmentExtractOptions, AttachmentFileInput } from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];

export class ImageExtractor implements AttachmentExtractor {
  readonly id = 'image';

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'image';
  }

  async extract(input: AttachmentFileInput, _options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    const format = sniffImageFormat(input.head) ?? input.extension ?? 'image';
    return {
      kind: input.kind,
      text: '',
      chunks: [],
      warnings: [],
      metadata: { image: { format } }
    };
  }
}

function sniffImageFormat(head: Uint8Array): string | undefined {
  if (startsWith(head, PNG_SIGNATURE)) return 'png';
  if (startsWith(head, JPEG_SIGNATURE)) return 'jpeg';
  if (startsWith(head, GIF_SIGNATURE)) return 'gif';
  return undefined;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}
