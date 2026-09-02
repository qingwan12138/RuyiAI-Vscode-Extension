// Multimodal image extractor. Image bytes remain in the Extension Host and are
// converted to a bounded in-memory base64 payload only after both the selected
// model and provider transport have passed the vision gate. The payload is never
// persisted in Session JSON; cross-turn use re-reads the original file reference.

import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput,
  AttachmentImageMimeType
} from '../../context/attachment/attachmentTypes';
import { AttachmentExtractor } from './attachmentExtractor';
import { AttachmentExtractionError } from './attachmentErrors';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50];

export class ImageExtractor implements AttachmentExtractor {
  readonly id = 'image';

  canHandle(input: AttachmentFileInput): boolean {
    return input.kind === 'image';
  }

  async extract(input: AttachmentFileInput, _options: AttachmentExtractOptions): Promise<AttachmentExtractionResult> {
    const mimeType = sniffImageMimeType(input.head) ?? mimeTypeFromExtension(input.extension);
    if (!mimeType) {
      throw new AttachmentExtractionError('This image format is not supported for model input. Use PNG, JPEG, WebP, or GIF.');
    }
    return {
      kind: input.kind,
      text: '',
      chunks: [],
      warnings: [],
      metadata: { image: { format: mimeType.slice('image/'.length) } },
      image: {
        mimeType,
        dataBase64: Buffer.from(input.bytes).toString('base64')
      }
    };
  }
}

function sniffImageMimeType(head: Uint8Array): AttachmentImageMimeType | undefined {
  if (startsWith(head, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(head, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(head, GIF_SIGNATURE)) return 'image/gif';
  if (startsWith(head, WEBP_RIFF) && startsWithAt(head, WEBP_TAG, 8)) return 'image/webp';
  return undefined;
}

function mimeTypeFromExtension(extension?: string): AttachmentImageMimeType | undefined {
  switch (extension?.toLowerCase()) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return undefined;
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return startsWithAt(bytes, signature, 0);
}

function startsWithAt(bytes: Uint8Array, signature: number[], offset: number): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}
