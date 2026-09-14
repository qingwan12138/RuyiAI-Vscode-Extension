/**
 * The one thing a user cannot guess about the bundled web-search server: where its
 * script lives. VS Code installs extensions into a *versioned* directory, so the
 * absolute path only exists at runtime and cannot be written into the docs.
 *
 * This module is the pure half — it turns a known path into the exact JSON to paste
 * into `yisiAI.mcpServers`. The composition root owns the one impure step
 * (`extensionUri`), so this stays testable without VS Code.
 *
 * Deliberately **not** a special case in the MCP config parser: the produced
 * document is ordinary `yisiAI.mcpServers` content. Web search is a plug-in, not a
 * second mechanism with its own rules (docs/decisions/ADR-0013).
 */

/** The server name; it fixes the bridged tool ids (`mcp__websearch__web_search`). */
export const WEB_SEARCH_SERVER_NAME = 'websearch';

/** Where the compiled server lives inside the extension, as path segments. */
export const WEB_SEARCH_SERVER_SCRIPT = ['dist', 'yisi', 'mcp-server', 'websearch', 'server.js'];

/**
 * The environment variable the server reads to find its search backend. It is an
 * environment variable rather than a config field on purpose: an MCP entry inherits
 * the extension host's environment, and `yisiAI.mcpServers` deliberately carries no
 * `env` map — that is where people would put tokens in `settings.json`, which the
 * MCP rule forbids. A backend URL is not a secret, so it lives in the environment
 * like every other server's configuration.
 */
export const WEB_SEARCH_BACKEND_ENV = 'YISI_SEARXNG_URL';

/**
 * The default backend address: a SearXNG instance on the same machine. It is a real
 * default rather than a placeholder so that "install SearXNG locally and it works"
 * needs no configuration at all; anything else is an explicit `YISI_SEARXNG_URL`.
 * It is loopback, so it never leaves the machine unless the user says so.
 */
export const DEFAULT_SEARXNG_URL = 'http://127.0.0.1:8080';

export interface WebSearchServerEntry {
  name: string;
  command: string;
  args: string[];
  toolRisks: Record<string, string>;
}

/**
 * The `yisiAI.mcpServers` entry for the bundled server.
 *
 * Both tools are declared `network`: that is the honest risk class (data leaves the
 * machine) and it is what makes Plan refuse them and every other mode ask. Declaring
 * them `readOnly` would run them unattended in *every* mode including Plan — the
 * exact failure the `network` axis exists to prevent (AGENTS.md, MCP rule).
 */
export function buildWebSearchServerEntry(serverScriptPath: string): WebSearchServerEntry {
  return {
    name: WEB_SEARCH_SERVER_NAME,
    command: 'node',
    args: [serverScriptPath],
    toolRisks: { web_search: 'network', web_fetch: 'network' }
  };
}

/** The entry as the JSON text a user pastes into the `yisiAI.mcpServers` array. */
export function renderWebSearchConfig(serverScriptPath: string): string {
  return JSON.stringify(buildWebSearchServerEntry(serverScriptPath), null, 2);
}

/**
 * What the user still has to do after pasting the entry. Kept next to the builder so
 * the command's message and the documentation cannot drift apart about the backend.
 */
export function webSearchSetupNotes(backendUrl?: string): string[] {
  const address = backendUrl?.trim() || DEFAULT_SEARXNG_URL;
  return [
    `web_search needs a search backend. Without one it reports that honestly instead of pretending it searched.`,
    `Default: a SearXNG instance on this machine at ${address} (free, self-hosted; the extension never bundles or calls a paid search API).`,
    `A different address goes in the ${WEB_SEARCH_BACKEND_ENV} environment variable, which MCP servers inherit — not in settings.json.`,
    `web_fetch needs no backend at all.`
  ];
}
