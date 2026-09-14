// The native (server-side) search backend: no search vendor, no SearXNG -- the model
// endpoint does the searching.
//
// Everything here is offline: a fake fetch stands in for the Messages API, so what is
// being tested is our side of the contract -- the request we build, the blocks we
// accept, and the honesty of every failure. The one thing this cannot test is whether
// a given endpoint really supports the server tool; that needs a real key.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_NATIVE_SEARCH_MODEL,
  DEFAULT_SEARCH_BASE_URL,
  NATIVE_SEARCH_TOOL,
  createNativeSearchBackend,
  messagesEndpoint,
  parseNativeSearchResponse
} = require('../dist/yisi/mcp-server/websearch/nativeSearchBackend');
const { resolveSearchBackend } = require('../dist/yisi/mcp-server/websearch/server');

const SIGNAL = new AbortController().signal;

/** A Messages API answer shaped the way server-side search answers. */
function answerWithBlocks(blocks) {
  return { id: 'msg_1', type: 'message', role: 'assistant', content: blocks };
}

const RESULT_BLOCK = {
  type: 'web_search_tool_result',
  tool_use_id: 'srvtoolu_1',
  content: [
    { type: 'web_search_result', url: 'https://ruyisdk.org/docs', title: 'RuyiSDK docs', page_age: '2026-01-01' },
    { type: 'web_search_result', url: 'https://github.com/ruyisdk/ruyisdk/releases', title: 'Releases', page_age: null }
  ]
};

const TEXT_BLOCK = {
  type: 'text',
  text: 'RuyiSDK ships several releases.',
  citations: [
    { type: 'web_search_result_location', url: 'https://ruyisdk.org/docs', cited_text: 'Installation guide' },
    { type: 'web_search_result_location', url: 'https://github.com/ruyisdk/ruyisdk/releases', cited_text: 'Latest release notes' }
  ]
};

test('the request declares the documented server tool, not a client tool', async () => {
  const seen = [];
  const backend = createNativeSearchBackend({
    baseUrl: DEFAULT_SEARCH_BASE_URL,
    apiKey: 'secret-key',
    fetchImpl: async (url, init) => {
      seen.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => answerWithBlocks([RESULT_BLOCK]) };
    }
  });

  const result = await backend('ruyisdk latest release', 6, SIGNAL);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen[0].init.headers['x-api-key'], 'secret-key');
  assert.deepEqual(seen[0].body.tools, [{ type: NATIVE_SEARCH_TOOL, name: 'web_search', max_uses: 1 }]);
  assert.equal(seen[0].body.model, DEFAULT_NATIVE_SEARCH_MODEL);
  assert.deepEqual(seen[0].body.messages, [{ role: 'user', content: 'ruyisdk latest release' }]);
  assert.equal(result.backend, 'native');
  assert.deepEqual(result.hits.map(hit => hit.url), [
    'https://ruyisdk.org/docs',
    'https://github.com/ruyisdk/ruyisdk/releases'
  ]);
});

test('results come from structured blocks, and the provider prose is discarded', () => {
  const hits = parseNativeSearchResponse(answerWithBlocks([RESULT_BLOCK, TEXT_BLOCK]));
  assert.equal(hits.length, 2);
  assert.equal(hits[0].title, 'RuyiSDK docs');
  // The snippet is the citation for that URL -- not a sentence the model wrote about it.
  assert.equal(hits[0].snippet, 'Installation guide');
  assert.equal(hits[1].snippet, 'Latest release notes');
  assert.equal(
    hits.some(hit => hit.title.includes('RuyiSDK ships several releases')),
    false,
    'provider prose must never become a result'
  );
});

test('a repeated URL from a multi-search request is returned once', () => {
  const hits = parseNativeSearchResponse(answerWithBlocks([RESULT_BLOCK, RESULT_BLOCK]));
  assert.deepEqual(hits.map(hit => hit.url), [
    'https://ruyisdk.org/docs',
    'https://github.com/ruyisdk/ruyisdk/releases'
  ]);
});

test('an answer with no search block is an error, never an empty result', () => {
  // "The endpoint did not actually search" must not look like "the web had nothing".
  assert.throws(
    () => parseNativeSearchResponse(answerWithBlocks([{ type: 'text', text: 'I already know this.' }])),
    /without a web search result block.*nothing was actually searched.*I already know this/s
  );
  assert.throws(() => parseNativeSearchResponse({ content: [] }), /nothing was actually searched/);
});

test('a provider-side search error is surfaced by its code', () => {
  assert.throws(
    () => parseNativeSearchResponse(answerWithBlocks([
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }
    ])),
    /max_uses_exceeded/
  );
});

test('an HTTP failure names the endpoint and never echoes the key', async () => {
  const backend = createNativeSearchBackend({
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'super-secret-value',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      text: async () => 'bad model; key=super-secret-value'
    })
  });
  await assert.rejects(
    () => backend('x', 3, SIGNAL),
    error => {
      assert.match(error.message, /HTTP 400/);
      assert.match(error.message, /api\.deepseek\.com\/anthropic\/v1\/messages/);
      assert.match(error.message, /YISI_SEARCH_MODEL/);
      assert.equal(error.message.includes('super-secret-value'), false, 'the key must be redacted');
      return true;
    }
  );
});

test('a non-JSON answer and a cancellation are reported differently', async () => {
  const broken = createNativeSearchBackend({
    baseUrl: DEFAULT_SEARCH_BASE_URL,
    apiKey: 'k',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })
  });
  await assert.rejects(() => broken('x', 3, SIGNAL), /did not return JSON/);

  const controller = new AbortController();
  controller.abort();
  const cancelled = createNativeSearchBackend({
    baseUrl: DEFAULT_SEARCH_BASE_URL,
    apiKey: 'k',
    fetchImpl: async () => { throw new Error('aborted'); }
  });
  await assert.rejects(() => cancelled('x', 3, controller.signal), error => {
    assert.equal(error.name, 'AbortError');
    return true;
  });
});

test('both endpoint spellings reach /v1/messages exactly once', () => {
  assert.equal(messagesEndpoint('https://api.deepseek.com/anthropic'), 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(messagesEndpoint('https://api.deepseek.com/anthropic/'), 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(messagesEndpoint('https://api.deepseek.com/anthropic/v1'), 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(messagesEndpoint('https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
});

// --- backend selection -----------------------------------------------------------------
// Precedence is the part a user cannot see and will therefore get wrong; it is pinned here.

test('an existing model key is enough: no SearXNG needed, no extra purchase', () => {
  const chosen = resolveSearchBackend({ DEEPSEEK_API_KEY: 'sk-abc123def456' });
  assert.equal(chosen.kind, 'native');
  assert.ok(chosen.backend, 'a backend must exist so web_search can run');
  assert.match(chosen.note, /api\.deepseek\.com\/anthropic/);
  assert.equal(chosen.note.includes('sk-abc123def456'), false, 'the note must not contain the key');
});

test('an explicit SearXNG address wins over an ambient model key', () => {
  assert.equal(resolveSearchBackend({ DEEPSEEK_API_KEY: 'k', YISI_SEARXNG_URL: 'http://127.0.0.1:8080' }).kind, 'searxng');
});

test('an explicit backend choice wins over both, including switching search off', () => {
  const off = resolveSearchBackend({ YISI_SEARCH_BACKEND: 'none', DEEPSEEK_API_KEY: 'k', YISI_SEARXNG_URL: 'http://x' });
  assert.equal(off.kind, 'none');
  assert.equal(off.backend, undefined);
  assert.match(off.note, /disabled/);
  assert.equal(resolveSearchBackend({ YISI_SEARCH_BACKEND: 'searxng', DEEPSEEK_API_KEY: 'k' }).kind, 'none');
  assert.match(
    resolveSearchBackend({ YISI_SEARCH_BACKEND: 'searxng', DEEPSEEK_API_KEY: 'k' }).note,
    /needs YISI_SEARXNG_URL/
  );
});

test('nothing configured says what to do instead of silently searching nothing', () => {
  const chosen = resolveSearchBackend({});
  assert.equal(chosen.kind, 'none');
  assert.match(chosen.note, /YISI_SEARXNG_URL/);
  assert.match(chosen.note, /DEEPSEEK_API_KEY/);
  assert.match(chosen.note, /web_fetch works without either/);
});

test('an unrecognised backend name is reported, not guessed at', () => {
  const chosen = resolveSearchBackend({ YISI_SEARCH_BACKEND: 'brve' });
  assert.equal(chosen.kind, 'none');
  assert.match(chosen.note, /Unknown YISI_SEARCH_BACKEND "brve"/);
});

test('the model and endpoint are overridable because both drift', () => {
  const backend = createNativeSearchBackend({
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'k',
    model: 'claude-x',
    toolType: 'web_search_20260101',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'claude-x');
      assert.deepEqual(body.tools, [{ type: 'web_search_20260101', name: 'web_search', max_uses: 1 }]);
      return { ok: true, status: 200, json: async () => answerWithBlocks([RESULT_BLOCK]) };
    }
  });
  return backend('x', 3, SIGNAL);
});
