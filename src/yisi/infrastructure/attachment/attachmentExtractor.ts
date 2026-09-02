// Extractor contract for the attachment pipeline.
//
// Each extractor is responsible for one family of formats and turns a bounded
// raw file into structured text + metadata. Adding a format only means writing
// an AttachmentExtractor and registering it here — never growing an if/else
// chain across formats.

import {
  AttachmentExtractionResult,
  AttachmentExtractOptions,
  AttachmentFileInput
} from '../../context/attachment/attachmentTypes';
import { AttachmentExtractionError } from './attachmentErrors';

export interface AttachmentExtractor {
  /** Stable identifier used in diagnostics. */
  readonly id: string;
  /** Whether this extractor can parse the classified input (kind + extension). */
  canHandle(input: AttachmentFileInput): boolean;
  extract(
    input: AttachmentFileInput,
    options: AttachmentExtractOptions
  ): Promise<AttachmentExtractionResult>;
}

export class AttachmentExtractorRegistry {
  private readonly extractors: AttachmentExtractor[] = [];

  register(extractor: AttachmentExtractor): this {
    this.extractors.push(extractor);
    return this;
  }

  pick(input: AttachmentFileInput): AttachmentExtractor | undefined {
    return this.extractors.find(extractor => extractor.canHandle(input));
  }

  async extract(
    input: AttachmentFileInput,
    options: AttachmentExtractOptions
  ): Promise<AttachmentExtractionResult> {
    const extractor = this.pick(input);
    if (!extractor) {
      throw new AttachmentExtractionError('No extractor is registered for this file type.');
    }
    return extractor.extract(input, options);
  }
}
