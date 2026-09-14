import { FetchLike, SearchBackend, SearchHit } from './webTools';

/**
 * A search backend that uses a model endpoint's **native server-side web search**
 * instead of a separate search service.
 *
 * Why this exists: DeepSeek (and Anthropic) expose web search as a *server tool* on
 * their Messages API. You send a Messages request that declares the search tool, the
 * provider runs the search on its own infrastructure, and the answer comes back as
 * structured `web_search_tool_result` blocks. That means **no search vendor, no extra
 * account, no API key beyond the model key the user already has** — which is exactly
 * what "general-purpose search that costs nothing extra" needs.
 *
 * Where it sits: it is a `SearchBackend` for the bundled web-search MCP server, i.e. a
 * drop-in alternative to the SearXNG backend. That placement is deliberate. It keeps
 * search a **client-side tool call** that goes through the PermissionEngine like any
 * other tool, so the `network` axis can still refuse it in Plan mode and ask in the
 * other modes. A server-side search invoked from *inside* a normal chat turn would
 * have no such gate — the model would simply search, and no approval card would ever
 * appear.
 *
 * Cost, stated plainly: one search costs one model turn in latency and tokens on the
 * user's existing account. It is not free, and it is not a new bill either.
 *
 * Clean-room note: this is an independent client of the *public* Anthropic Messages
 * API shape. The mechanism (native server search behind an Anthropic-format endpoint,
 * one search = one model turn, results parsed only from structured blocks) was already
 * recorded in docs/14 as research before this file existed; no implementation was
 * copied. The wire contract used here is the documented `web_search_20250305` tool.
 */

/** The documented server-tool type for provider-side web search. */
export const NATIVE_SEARCH_TOOL = 'web_search_20250305';
/** The tool name the results come back under. */
export const NATIVE_SEARCH_TOOL_NAME = 'web_search';
/** Anthropic Messages API version header. */
export const DEFAULT_API_VERSION = '2023-06-01';
/**
 * Default endpoint: DeepSeek's Anthropic-compatible Messages API. It is the endpoint
 * that supports server-side search, and the key the user already has works with it.
 */
export const DEFAULT_SEARCH_BASE_URL = 'https://api.deepseek.com/anthropic';
/**
 * Default model for the *search* request. Publicly stable DeepSeek alias; it only has
 * to be a model that can trigger the server tool. If the endpoint rejects it, the error
 * names the env var to fix, and `scripts/probe-native-search.js` finds the right one in
 * one command — because the model lineup drifts and a hardcoded guess must never be a
 * silent failure.
 */
export const DEFAULT_NATIVE_SEARCH_MODEL = 'deepseek-flash';

export interface NativeSearchOptions {
  /** Base URL of an Anthropic-compatible Messages API, e.g. `https://api.deepseek.com/anthropic`. */
  baseUrl: string;
  /** The model key. Sent as `x-api-key` and as a bearer token. */
  apiKey: string;
  model?: string;
  /** Override the server-tool type (for endpoints that version it differently). */
  toolType?: string;
  /** How many times the provider may search within one request. */
  maxUses?: number;
  maxTokens?: number;
  apiVersion?: string;
  fetchImpl?: FetchLike;
}

export function createNativeSearchBackend(options: NativeSearchOptions): SearchBackend {
  const endpoint = messagesEndpoint(options.baseUrl);
  const model = options.model?.trim() || DEFAULT_NATIVE_SEARCH_MODEL;
  const toolType = options.toolType?.trim() || NATIVE_SEARCH_TOOL;
  return async (query, maxResults, signal) => {
    const request = {
      model,
      max_tokens: options.maxTokens ?? 1024,
      messages: [{ role: 'user', content: query }],
      // The declared server tool is what makes this a search rather than a question.
      tools: [{ type: toolType, name: NATIVE_SEARCH_TOOL_NAME, max_uses: options.maxUses ?? 1 }]
    };
    let response: Response;
    try {
      response = await (options.fetchImpl ?? (globalThis.fetch as FetchLike))(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': options.apiVersion ?? DEFAULT_API_VERSION,
          'x-api-key': options.apiKey,
          authorization: `Bearer ${options.apiKey}`
        },
        body: JSON.stringify(request)
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(
        `Could not reach the search endpoint at ${endpoint}: ${describe(error)}. `
        + 'This backend needs an Anthropic-compatible Messages API that supports server-side web search.'
      );
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        detail = '';
      }
      // Never echo the key back, even if the provider includes it in an error.
      if (detail) detail = detail.split(options.apiKey).join('[REDACTED]');
      throw new Error(
        `The search endpoint at ${endpoint} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}. `
        + `It must accept the server tool type ${toolType} and a model that can trigger it`
        + ` (currently "${model}"; set YISI_SEARCH_MODEL to change it).`
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(`The search endpoint at ${endpoint} did not return JSON.`, { cause: error });
    }
    return { hits: parseNativeSearchResponse(payload), backend: 'native' };
  };
}

/**
 * Turns a Messages API response into search hits.
 *
 * Only the structured blocks are read. The provider's own prose is **discarded**: it is
 * a summary, not a source, and treating it as the answer is how a search result becomes
 * an unverifiable claim. An answer with no search block at all is an error, not an
 * empty result — "the endpoint did not actually search" must never look like "the web
 * had nothing".
 */
export function parseNativeSearchResponse(payload: unknown): SearchHit[] {
  if (!isRecord(payload)) throw new Error('The search endpoint returned an unexpected JSON shape.');
  const blocks = Array.isArray(payload.content) ? payload.content : [];

  const resultBlocks = blocks.filter(
    block => isRecord(block) && block.type === 'web_search_tool_result'
  );
  if (!resultBlocks.length) {
    const prose = blocks
      .map(block => (isRecord(block) && typeof block.text === 'string' ? block.text.trim() : ''))
      .filter(Boolean)
      .join(' ')
      .slice(0, 200);
    throw new Error(
      'The search endpoint answered without a web search result block, so nothing was actually searched. '
      + `${prose ? `It said: ${prose} ` : ''}`
      + 'The endpoint must support server-side web search for this backend to work.'
    );
  }

  // An error is reported *inside* a result block, as an object instead of a list.
  for (const block of resultBlocks) {
    if (!isRecord(block)) continue;
    const inner = block.content;
    if (!Array.isArray(inner) && isRecord(inner) && typeof inner.error_code === 'string') {
      throw new Error(`The provider reported a search error: ${inner.error_code}.`);
    }
  }

  const cited = collectCitations(blocks);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const block of resultBlocks) {
    if (!isRecord(block) || !Array.isArray(block.content)) continue;
    for (const item of block.content) {
      if (!isRecord(item)) continue;
      if (typeof item.type === 'string' && item.type !== 'web_search_result') continue;
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!url || seen.has(url)) continue; // a multi-search request repeats URLs
      seen.add(url);
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      hits.push({
        title: title || url,
        url,
        snippet: (cited.get(url) ?? []).join(' ').trim().slice(0, 600)
      });
    }
  }
  return hits;
}

/**
 * Snippets come from citation entries, which are keyed by URL and live in the text
 * blocks rather than next to the result. Joining them is what makes a hit readable
 * without trusting the provider's summary.
 */
function collectCitations(blocks: unknown[]): Map<string, string[]> {
  const cited = new Map<string, string[]>();
  for (const block of blocks) {
    if (!isRecord(block) || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations) {
      if (!isRecord(citation)) continue;
      const url = typeof citation.url === 'string' ? citation.url.trim() : '';
      const text = typeof citation.cited_text === 'string' ? citation.cited_text.trim() : '';
      if (!url || !text) continue;
      const snippets = cited.get(url) ?? [];
      if (snippets.length < 3) snippets.push(text);
      cited.set(url, snippets);
    }
  }
  return cited;
}

/**
 * Accepts both `.../anthropic` and `.../anthropic/v1`, because a user copying an
 * endpoint out of another tool's configuration should not have to know which form this
 * code expects.
 */
export function messagesEndpoint(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  return /\/v1$/.test(root) ? `${root}/messages` : `${root}/v1/messages`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
