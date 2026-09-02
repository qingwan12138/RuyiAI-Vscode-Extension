// Renders structured attachment context into model-facing prompt text. The
// output keeps per-chunk provenance (page / slide / sheet / line range) so the
// model can cite where a passage came from instead of receiving one anonymous
// blob. Kept dependency-free for unit testing.

import { AttachmentChunk, AttachmentContext } from '../../context/attachment/attachmentTypes';

/** Conservative token estimate (v0.1 has no provider tokenizer): ~4 chars/token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Render an attachment as a single source-labelled block. */
export function renderAttachmentContext(context: AttachmentContext, chunks: AttachmentChunk[] = context.chunks): string {
  const blocks: string[] = [`[Attachment: ${context.fileName}]`];
  for (const chunk of chunks) {
    const header = chunkHeader(chunk);
    blocks.push(header ? `${header}\n${chunk.text}` : chunk.text);
  }
  if (context.truncated) {
    blocks.push('[Note: this attachment is truncated; its full content is not included.]');
  }
  return blocks.join('\n\n');
}

/** Provenance label for a chunk, derived from its structural metadata. */
export function chunkHeader(chunk: AttachmentChunk): string {
  if (chunk.page !== undefined) return `[Page: ${chunk.page}]`;
  if (chunk.slide !== undefined) return `[Slide: ${chunk.slide}]`;
  if (chunk.sheet !== undefined) {
    return chunk.cellRange ? `[Sheet: ${chunk.sheet} · ${chunk.cellRange}]` : `[Sheet: ${chunk.sheet}]`;
  }
  if (chunk.startLine !== undefined && chunk.endLine !== undefined) {
    return `[Lines: ${chunk.startLine}-${chunk.endLine}]`;
  }
  return '';
}

// Central budget configuration. `maxTokens` is an absolute cap on attachment
// context so N large attachments can never flood the model, even when the model
// advertises no context length.
export interface AttachmentBudget {
  maxTokens: number;
  outputReserveRatio: number;
  minTokens: number;
}

export const DEFAULT_ATTACHMENT_BUDGET: AttachmentBudget = Object.freeze({
  maxTokens: 32_000,
  outputReserveRatio: 0.25,
  minTokens: 1_024
});

/**
 * Attachment budget derived from the model's context window: reserve space for
 * output and for already-present conversation text, then cap at the absolute
 * attachment ceiling. Returns 0 when there is no room left.
 */
export function computeAttachmentBudget(
  maxContextTokens: number | undefined,
  historyText: string,
  userText: string,
  budget: AttachmentBudget = DEFAULT_ATTACHMENT_BUDGET
): number {
  if (maxContextTokens === undefined || maxContextTokens <= 0) {
    return budget.maxTokens;
  }
  const outputReserve = Math.floor(maxContextTokens * budget.outputReserveRatio);
  const consumed = estimateTokens(historyText) + estimateTokens(userText);
  const available = maxContextTokens - outputReserve - consumed;
  if (available < budget.minTokens) return 0;
  return Math.min(budget.maxTokens, available);
}

/**
 * Assemble multiple attachments into one prompt block under a token budget.
 * The budget is split evenly across attachments (fairness: one large file must
 * not starve its siblings), then each attachment contributes as many leading
 * chunks as fit in its share.
 */
export function assembleAttachmentContexts(attachments: AttachmentContext[], budgetTokens: number): string {
  if (attachments.length === 0 || budgetTokens <= 0) return '';
  const perAttachment = Math.max(1, Math.floor(budgetTokens / attachments.length));
  const blocks: string[] = [];
  for (const attachment of attachments) {
    const chunks = selectChunksWithinBudget(attachment.chunks, perAttachment);
    if (chunks.length > 0) blocks.push(renderAttachmentContext(attachment, chunks));
  }
  return blocks.join('\n\n');
}

/** Leading chunks whose combined cost fits the budget; never exceeds it. */
export function selectChunksWithinBudget(chunks: AttachmentChunk[], budgetTokens: number): AttachmentChunk[] {
  const selected: AttachmentChunk[] = [];
  let used = 0;
  for (const chunk of chunks) {
    const cost = estimateTokens(chunk.text) + estimateTokens(chunkHeader(chunk)) + 1;
    if (used + cost > budgetTokens) break;
    selected.push(chunk);
    used += cost;
  }
  return selected;
}
