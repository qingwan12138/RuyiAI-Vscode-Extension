#!/usr/bin/env node
// One-command check: does this endpoint really do server-side web search?
//
// The backend is written against the documented Messages API, but two things cannot be
// verified without a real key: which model id the endpoint accepts, and whether it
// accepts the server-tool type. Rather than guess and ship a silent failure, this probe
// answers both questions against the real endpoint and prints the exact request it made.
//
//   npm run compile
//   DEEPSEEK_API_KEY=sk-... node scripts/probe-native-search.js "ruyisdk latest release"
//
// Optional: YISI_SEARCH_BASE_URL, YISI_SEARCH_MODEL, YISI_SEARCH_TOOL.
// Exit code 0 = a real search came back. 1 = it did not, with the provider's own words.

const path = require('node:path');

const root = path.join(__dirname, '..');
const {
  createNativeSearchBackend,
  DEFAULT_NATIVE_SEARCH_MODEL,
  DEFAULT_SEARCH_BASE_URL,
  NATIVE_SEARCH_TOOL,
  messagesEndpoint
} = require(path.join(root, 'dist', 'yisi', 'mcp-server', 'websearch', 'nativeSearchBackend'));

const query = process.argv[2] || 'ruyisdk latest release';
const apiKey = process.env.YISI_SEARCH_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY;
const baseUrl = process.env.YISI_SEARCH_BASE_URL || DEFAULT_SEARCH_BASE_URL;
const toolType = process.env.YISI_SEARCH_TOOL || NATIVE_SEARCH_TOOL;

if (!apiKey) {
  console.error(
    'No API key. Set YISI_SEARCH_API_KEY, DEEPSEEK_API_KEY or ANTHROPIC_API_KEY.\n'
    + 'The key is read from the environment only -- never passed as an argument, so it cannot\n'
    + 'leak into your shell history or a process list.'
  );
  process.exitCode = 2;
  return;
}

/** Model ids worth trying, because the lineup drifts and a stale id is a hard 400. */
function candidates() {
  const explicit = process.env.YISI_SEARCH_MODEL;
  if (explicit) return [explicit];
  const fromEnv = process.env.YISI_SEARCH_MODEL_CANDIDATES;
  if (fromEnv) return fromEnv.split(',').map(value => value.trim()).filter(Boolean);
  if (/anthropic\.com/.test(baseUrl)) {
    return ['claude-sonnet-4-5', 'claude-3-5-haiku-latest'];
  }
  return [DEFAULT_NATIVE_SEARCH_MODEL, 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'];
}

// Never `process.exit()` while a fetch may still be settling: on Windows that trips a
// libuv assertion (`UV_HANDLE_CLOSING`) and the process dies mid-report. Abort instead
// and let the loop drain, so the exit code is the only signal that matters.
const controller = new AbortController();
const overall = setTimeout(() => controller.abort(), 120_000);

(async () => {
  console.log(`endpoint : ${messagesEndpoint(baseUrl)}`);
  console.log(`tool type: ${toolType}`);
  console.log(`query    : ${query}`);
  console.log(`key      : ${apiKey.slice(0, 4)}...${apiKey.slice(-2)} (${apiKey.length} chars)`);
  console.log('');

  for (const model of candidates()) {
    if (controller.signal.aborted) break;
    process.stdout.write(`trying model ${model} ... `);
    const backend = createNativeSearchBackend({ baseUrl, apiKey, model, toolType });
    try {
      const started = Date.now();
      const { hits, backend: name } = await backend(query, 5, controller.signal);
      console.log(`OK (${Date.now() - started}ms, backend ${name})`);
      console.log(`\n${hits.length} result(s):`);
      for (const hit of hits) {
        console.log(`  - ${hit.title}`);
        console.log(`    ${hit.url}`);
        if (hit.snippet) console.log(`    ${hit.snippet.slice(0, 160)}`);
      }
      if (!hits.length) {
        console.log('  (the search ran but returned no results — the tool worked, the query found nothing)');
      }
      console.log('\nServer-side search works. web_search will use it with no further configuration.');
      if (model !== DEFAULT_NATIVE_SEARCH_MODEL) {
        console.log(`Set YISI_SEARCH_MODEL=${model} to skip the probe list on every start.`);
      }
      process.exitCode = 0;
      return;
    } catch (error) {
      console.log('failed');
      console.log(`  ${error.message}`);
    }
  }

  if (controller.signal.aborted) {
    console.error('\nTimed out after 120s. The endpoint did not answer.');
  } else {
    console.log(
      '\nNo model worked. The provider\'s own message is printed above; common causes are a model id\n'
      + 'this key cannot use, an endpoint that does not implement server-side search, or a different\n'
      + 'tool type. Set YISI_SEARCH_MODEL / YISI_SEARCH_TOOL to the values from provider documentation.'
    );
  }
  process.exitCode = 1;
})().catch(error => {
  // Anything thrown outside the per-model try (a malformed base URL, say) still has to
  // end as a reported failure rather than an unhandled rejection.
  console.error(`\nProbe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}).finally(() => clearTimeout(overall));

