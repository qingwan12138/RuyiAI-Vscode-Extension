import { AgentToolEvent } from '../application/agent/readOnlyAgentLoop';

/**
 * Machine-readable events for a headless run.
 *
 * `--json` used to print a single result object at the end, which is fine for a
 * short task and useless for a long one: a CI job watching a twenty-minute run
 * had no way to tell "working" from "hung" until it was over. This is the
 * streaming form — one JSON object per line (NDJSON), written as things happen:
 *
 *   {"type":"tool","id":"c1","name":"read_file","outcome":"call"}
 *   {"type":"tool","id":"c1","name":"read_file","outcome":"succeeded","summary":"..."}
 *   {"type":"delta","text":"..."}
 *   {"type":"result","status":"completed","text":"..."}
 *
 * The final `result` line is always last, so a consumer can keep its simple path
 * (parse the last line) while still being able to show progress. Every event is
 * bounded where it is produced: tool summaries come from the loop already capped,
 * so a chatty tool cannot flood the stream.
 */

export type HeadlessEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      outcome: 'call' | 'succeeded' | 'failed';
      summary?: string;
    }
  | { type: 'result'; status: 'completed' | 'blocked'; text: string; reason?: string };

/** Maps one loop tool event onto a headless event. */
export function toolEventToHeadless(event: AgentToolEvent): HeadlessEvent {
  if (event.type === 'toolCall') {
    return { type: 'tool', id: event.id, name: event.name, outcome: 'call' };
  }
  return {
    type: 'tool',
    id: event.id,
    name: event.name,
    outcome: event.outcome === 'succeeded' ? 'succeeded' : 'failed',
    summary: event.summary
  };
}

/** One NDJSON line, newline included. */
export function toJsonLine(event: HeadlessEvent): string {
  return `${JSON.stringify(event)}\n`;
}
