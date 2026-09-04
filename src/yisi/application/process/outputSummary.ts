// Pure command-output summarization (C3).
//
// The process runner already bounds captured output bytes; on top of that the
// command tool summarizes long stdout/stderr so the model sees the meaningful
// head + the failing tail (errors live at the end) instead of a giant middle.
// Pure and dependency-free so it is unit-testable.

export interface OutputSummary {
  /** Readable text: full when small, otherwise head + omission marker + tail. */
  text: string;
  /** Total characters of the original output (before truncation to bounds). */
  totalCharacters: number;
  /** True when the original exceeded the summary window. */
  truncated: boolean;
  /** Characters kept from the head (0 when untruncated). */
  headCharacters: number;
  /** Characters kept from the tail (0 when untruncated). */
  tailCharacters: number;
}

export const DEFAULT_HEAD_CHARACTERS = 4_000;
export const DEFAULT_TAIL_CHARACTERS = 8_000;
const OMISSION_MARKER = '\n… [middle output omitted for context budget] …\n';

/**
 * Summarize captured command output. Small outputs pass through verbatim; large
 * ones keep `headCharacters` from the start and `tailCharacters` from the end
 * (build/test failures usually surface in the tail).
 */
export function summarizeOutput(
  text: string,
  headCharacters = DEFAULT_HEAD_CHARACTERS,
  tailCharacters = DEFAULT_TAIL_CHARACTERS
): OutputSummary {
  const totalCharacters = text.length;
  if (text.length <= headCharacters + tailCharacters) {
    return {
      text,
      totalCharacters,
      truncated: false,
      headCharacters: 0,
      tailCharacters: 0
    };
  }
  const head = text.slice(0, headCharacters);
  const tail = text.slice(text.length - tailCharacters);
  return {
    text: `${head}${OMISSION_MARKER}${tail}`,
    totalCharacters,
    truncated: true,
    headCharacters,
    tailCharacters
  };
}
