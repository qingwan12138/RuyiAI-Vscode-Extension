// Pure planning helpers for automatic post-edit validation (A3).
//
// Suggested-command strings come from the project detector (projectProfileDetector)
// and may contain shell chains (`&&`) or `./gradlew` wrappers. We translate them
// into structured (executable, args) runs that the command executor accepts —
// NEVER through a shell. Anything that cannot be expressed structurally is
// reported as unsupported instead of being executed.

export interface PlannedRun {
  executable: string;
  args: string[];
}

export interface ParseHintResult {
  runs: PlannedRun[];
  unsupported?: string;
}

const MAX_HINT_SEGMENTS = 4;

/**
 * Parse one detector hint into structured runs.
 * - `cmd1 && cmd2` becomes two sequential runs (no shell).
 * - `./gradlew test` becomes `bash ./gradlew test` because PATH lookup cannot
 *   run a workspace-relative script directly.
 * - Double-quoted argument groups are kept intact; anything else complex is
 *   refused as unsupported rather than guessed.
 */
export function parseCommandHint(hint: string): ParseHintResult {
  if (!hint || !hint.trim()) return { runs: [] };
  const segments = hint.split('&&').map(segment => segment.trim()).filter(Boolean);
  if (segments.length === 0) return { runs: [] };
  if (segments.length > MAX_HINT_SEGMENTS) {
    return { runs: [], unsupported: 'Command chain has too many segments.' };
  }
  const runs: PlannedRun[] = [];
  for (const segment of segments) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const first = tokens[0];
    if (first.startsWith('./')) {
      // Workspace-relative script: run through the POSIX shell explicitly.
      runs.push({ executable: 'bash', args: [first, ...tokens.slice(1)] });
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(first)) {
      return { runs: [], unsupported: `Unsupported command head "${first}".` };
    }
    if (first === 'sudo' || first === 'su' || first === 'pkexec') {
      return { runs: [], unsupported: 'Privileged commands are not auto-run.' };
    }
    runs.push({ executable: first, args: tokens.slice(1) });
  }
  return { runs };
}

/** Simple tokenizer: splits on spaces and keeps double-quoted groups intact. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
    } else if (character === ' ' && !quoted) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Keep at most this many runs per validation pass to bound wall-clock cost. */
export const MAX_VALIDATION_RUNS = 3;

/** Choose up to MAX_VALIDATION_RUNS hints, test-ish commands first. */
export function chooseValidationHints(testHints: readonly string[], buildHints: readonly string[]): string[] {
  const ranked = [
    ...testHints.filter(hint => /test|ctest|check/i.test(hint)),
    ...testHints.filter(hint => !/test|ctest|check/i.test(hint)),
    ...buildHints
  ];
  const seen = new Set<string>();
  const chosen: string[] = [];
  for (const hint of ranked) {
    if (seen.has(hint)) continue;
    seen.add(hint);
    chosen.push(hint);
    if (chosen.length >= MAX_VALIDATION_RUNS) break;
  }
  return chosen;
}
