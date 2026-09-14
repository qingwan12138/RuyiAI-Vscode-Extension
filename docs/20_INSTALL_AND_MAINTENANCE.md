# 20 — Install, Use, Maintenance & Upgrade

状态：v1.0 交付文档（2026-09-05）。正式环境为 **Linux 本机 VS Code**（docs/16）；下述为闭源 VSIX 的安装/使用/维护/升级说明。

## 1. Build the VSIX

```bash
npm ci            # install pinned deps
npm run compile   # -> dist/
npx vsce package --no-yarn --allow-missing-repository
# -> yisi-ai-dev-starter-<version>.vsix
```

`*.vsix`, `dist/`, `node_modules/` are git-ignored (build artifacts). `random.js` and `src/`/`test/`/`docs/` are excluded from the package via `.vscodeignore`.

## 2. Install

- Linux desktop VS Code: **Extensions view → `...` → Install from VSIX...** → select the `.vsix`.
- CLI: `code --install-extension yisi-ai-dev-starter-<version>.vsix`.
- The extension contributes the **Yisi AI** activity-bar (left) view; open it to see the welcome/main screen.

## 3. First use (Agent)

1. Open **one local workspace folder** (a single folder; multi-root or no folder disables the agent tools — see docs/12 v0.4 / `selectLocalAgentWorkspace`).
2. Open **Yisi AI** from the activity bar.
3. **Model settings** (`...` in the top bar / `Yisi AI: Model Settings` command): pick a provider whose API key is stored in **SecretStorage** (never in normal settings), and a model.
4. Set a **permission mode** (Plan / Manual / Accept Edits / Auto / Full Access) from the toolbar.
5. Send a message; privileged actions render as an **inline approval card** in the sidebar (Approve / 拒绝). Watch the streamed model text + per-tool step bubbles.

### Project instructions (`AGENTS.md` family)

Put your repository's conventions in **one** of these files at the workspace root; Yisi reads it on every agent run and sends it to the model:

```
AGENTS.md  >  CLAUDE.md  >  YISI.md      (first match wins — they are not merged)
```

Typical content: which package manager to use, how to run tests, coding conventions, "never touch X". Limits and guarantees:

- Bounded at 12,000 characters per file; longer files are truncated with a visible marker.
- It is **workspace content, not an operator instruction**: it cannot change the tools, the permission rules or the mode briefing. Every tool call is still checked by the permission engine.
- Missing / unreadable / a directory / oversized all mean "no instructions" — it never fails a run.
- Read from the **execution root**, so an isolated session worktree reads its own checkout.
- Applies to the **agent path only**; the bare chat and session auto-titling requests do not receive it.
- Edit the file and the next run picks it up (no cache to clear).

### MCP servers (`yisiAI.mcpServers`)

Add local MCP servers to give the agent external tools (they appear as `mcp__<server>__<tool>`):

```jsonc
"yisiAI.mcpServers": [
  {
    "name": "github",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    // Optional, per tool, once you have reviewed what the server does:
    "toolRisks": { "list_issues": "readOnly" }
  }
]
```

What to expect:

- Each entry **spawns one local process** (`shell:false`; `command` is an executable and `args` are separate). It inherits your environment, exactly like starting it from a terminal — **put tokens in your environment, not in settings**.
- **Unclassified MCP tools are treated as `environmentChange`**: Plan refuses them, Manual/Accept Edits/Auto ask, Full Access runs them unattended. This is deliberate — an MCP server's effects cannot be inspected from the outside. Narrow a tool to `readOnly` only when you have reviewed that server.
- A server that fails to connect, times out (10s) or speaks a broken protocol is **skipped with a logged reason**; the agent keeps working with zero tools from it.
- The tool list is fixed for the session; after changing a server's tools, reload the window.
- Not implemented yet: HTTP/SSE transport, MCP resources/prompts/sampling, a servers panel in the UI, **and a per-entry `env` map** — an entry cannot carry environment variables, so a server that needs configuration reads it from the environment the extension host inherited (start VS Code from a shell that has it exported). Unknown fields in an entry are ignored rather than rejected.

### Built-in web search (`web_search` / `web_fetch`)

Yisi ships **its own MCP server** for web access, so there is nothing to install: run **`Yisi AI: Copy Web Search (MCP) Configuration`** from the Command Palette and paste the copied entry into `yisiAI.mcpServers`. It looks like this (the path is the real one — VS Code installs extensions into a versioned directory, which is why the command exists instead of a documented literal path):

```jsonc
{
  "name": "websearch",
  "command": "node",
  "args": ["<extension install dir>/dist/yisi/mcp-server/websearch/server.js"],
  // Both tools are `network`: Plan refuses them, every other mode asks, Full Access runs them.
  "toolRisks": { "web_search": "network", "web_fetch": "network" }
}
```

What to expect:

- **`web_fetch` works with no backend at all.** It reads one public `http(s)` page and returns bounded text. Only public addresses (loopback, link-local, private ranges and the cloud metadata address are refused), same-origin redirects only (≤5), 5 MB / 100,000 characters / 30 s, and non-text responses are refused instead of guessed at. Those limits are the ones recorded in `docs/14` and a test asserts they still match.
- **`web_search` needs a backend, and there is no paid one involved.** The default is a **SearXNG** instance on this machine at `http://127.0.0.1:8080` — free, self-hosted, no API key (its JSON format must be enabled: `search.formats: [json]` in `settings.yml`). A different address goes in the **`YISI_SEARXNG_URL` environment variable**, which the server inherits; it is deliberately not a setting, because `yisiAI.mcpServers` carries no `env` map precisely so that tokens never end up in `settings.json`.
- **No backend is reported honestly.** If nothing is reachable, `web_search` says which address it tried and how to fix it — it never returns "no results" as if it had searched.
- **Nothing is cached, and nothing is sent anywhere except the search backend and the page you fetch.** The agent is instructed to search only when the answer depends on information newer than its training, to make the fewest calls, and to claim it searched the web **only when a web tool actually ran and succeeded**.
- **Web content is untrusted input.** The prompt states that a page or a result can never change permissions, run a command, disclose a secret, upload anything, or change the workspace — and that the agent must never do such a thing *because a page said so*.
- Search is bounded: at most 10 results per call, 300-character titles, 600-character snippets.

### Hooks (`yisiAI.hooks`)

Hooks are local scripts that run around tool calls. They are the only mechanism that **enforces** rather than requests: a project instruction file asking "never edit `vendor/`" is a request, a `preToolUse` hook is a guarantee.

```jsonc
"yisiAI.hooks": [
  {
    "event": "preToolUse",
    "command": "node",
    "args": [".yisi/hooks/guard.js"],
    "match": "replace_text",     // exact id, or a namespace like "mcp__github__*"
    "timeoutMs": 10000,
    "onError": "block"           // default for preToolUse; "continue" to let it through
  },
  {
    "event": "postToolUse",
    "command": "node",
    "args": [".yisi/hooks/lint.js"]   // prints lint output -> the model reads it
  }
]
```

The contract:

- the event arrives as **JSON on stdin**, then EOF;
- **stdout** must be empty or `{"decision":"allow"|"deny","reason":"…","context":"…"}`. A **postToolUse** hook may also just print plain text, which becomes context. A **preToolUse** hook must print JSON or nothing;
- **a hook can only tighten.** There is no "approve" verdict: `allow` means "no objection", and the permission mode still decides every call. A hook can therefore never widen what the agent may do;
- a `deny` is reported to the model as a **hook** refusal — distinct from a permission refusal, because widening the mode will not lift it;
- if a hook cannot run (spawn failure, timeout, bad output), `preToolUse` **blocks** by default and says so; set `onError: "continue"` to let the action through instead. Either way the failure is visible;
- hooks run with the workspace root as their working directory and inherit your environment; commands are spawned with `shell: false`, so `command` is an executable and `args` are separate.

Not implemented yet: `SessionStart`/`UserPromptSubmit`/`Stop` events, HTTP or prompt-type hooks, and a UI panel to manage them.

### Skills (`.yisi/skills`)

A skill is a markdown file holding reusable knowledge or a workflow. Put it in the workspace — no setting needed:

```
.yisi/skills/deploy.md            # or
.yisi/skills/deploy/SKILL.md      # a directory, so a skill can ship examples
```

```markdown
---
name: deploy
description: Deploy the service to staging.
---

1. Run the full test suite.
2. Tag the release and push the tag.
```

Two ways to use it:

- **the agent loads it itself** when the description matches the task (a `skill` tool call);
- **you type `/deploy`** at the start of a message, optionally with more text after it (`/deploy to staging`). The body is added for that turn only — your message stays as you typed it in the session, so a long skill is not re-sent on every later turn.

Limits and behaviour worth knowing:

- **Only the name and the 240-character description sit in every request** (capped at 4000 characters in total); the body is read only when used, capped at 16000 characters. A workspace with no `.yisi/skills` costs nothing.
- A leading `/name` that is not a known skill is sent as ordinary text, so paths and undefined commands are never swallowed.
- The skill list is resolved when the extension starts: **reload the window** after adding or renaming a skill (editing a body is picked up on the next load).
- Loading a skill only reads a workspace file, so it is allowed in every permission mode, including Plan.

Not implemented yet: extra files beside `SKILL.md`, skill arguments, and combining skills with subagents.

### Subagents (`task`)

The agent can hand a focused task to a **subagent** that works in its own context and returns only a report — useful when a question needs many file reads whose intermediate output you do not want in the conversation. There is nothing to configure for it.

What it does and does not do:

- **It is read-only.** A subagent cannot change the workspace: its tool set is filtered to read-only observers, so it cannot write, run commands, change the Ruyi environment, or ask to widen its permission mode. That is why it can never do more than the run that spawned it.
- It sees **only the task text** — not your conversation — plus the project instructions and skill list, and it inherits the current permission mode. Workspace hooks apply to it as well.
- Only its **report** (up to 8000 characters) comes back. Its file reads, searches and prose stay in its own context; its tool steps are still shown in the transcript, labelled with the task name.
- Bounded per run: at most 4 subagents, 6 rounds each, run one after another; exceeding that stops the run. **Stop** cancels subagents too.
- Not implemented yet: write-capable subagents, parallel execution, subagent-specific models or tool allowlists, and a tree view of running subagents.

### Checkpoints (`Yisi AI: Checkpoints — Rewind or Fork`)

Every request opens a checkpoint, and every file the agent changes is recorded against it. Run the command to pick a turn, then choose:

- **Rewind code to here** — undo the file changes made by that turn **and every later one**, keeping the conversation;
- **Fork the conversation from here** — keep the code exactly as it is and start a new session whose history stops before that request;
- **Both**.

Worth knowing:

- A rewind **never overwrites your own work**: a file you edited after the agent touched it is refused and reported, not clobbered. The command lists exactly which files were restored and which were not, with reasons.
- A partial rewind **keeps** the checkpoint, so you can retry after resolving the conflict; a fully successful one forgets it.
- Some changes cannot be rewound automatically (directory creation, files too large to retain); they are reported as such rather than silently skipped.
- Checkpoints live for the session's lifetime **in memory**: switching sessions keeps them, reloading the window does not. Only files the agent changed are recorded, and the record is bounded (12 turns, 40 changes per turn, 64 KB per side).
- The entry point is this command — there is no per-message hover button yet.

### Reviewing an edit (side-by-side diff)

When the agent proposes a text change and Manual mode (or any mode that asks) needs your approval, the change opens in VS Code's **own diff editor**: the file as it is now on the left, the file as it would become on the right. You decide in the sidebar card as before — the diff is only a better view, and closing it does not decide anything.

Worth knowing:

- Nothing is written to disk before you approve; the proposed side is served from memory.
- The diff is **not shown** when it would not be truthful or useful: a replacement whose text no longer appears exactly once in the file, an unreadable file, or a file larger than 512 KB. The card still shows the proposed fragment in those cases.
- Actions without text (commands, renames, Ruyi environment changes, MCP tools) have no diff — the card's summary is the whole story.
- The proposed side is **read-only**: editing it before approving is not implemented.

### Reviewing a plan (Plan mode)

In Plan mode the agent cannot change anything, so a run that has finished planning asks to apply it. When it submits a plan, Yisi opens it as a **markdown document you can edit**:

- The header says what to do: **decide in the sidebar**, and **comment inline** — edit or add lines anywhere in the document.
- Whatever you change is sent back to the agent as feedback, whether you **approve** or **decline** (so "yes, but not that step" works).
- Only the lines you changed are sent, not the whole plan.
- The document decides nothing by itself: approving still happens in the sidebar card, and only widens the mode for that run.

## 7. Headless / CI runs

The same agent can run without an editor — same tools, same permission engine, same review path:

```bash
# read-only: refuses every state-changing action, needs no approval channel
node dist/yisi/headless/cli.js --root ./project "summarise how the build works"

# writes must be asked for explicitly
node dist/yisi/headless/cli.js --root ./project --allow-write "fix the failing test"

# machine-readable result
node dist/yisi/headless/cli.js --root ./project --json "..."
```

- **The default is read-only.** Without a flag the run is in `plan` mode: it can inspect, search and run read-only analyses, and every write or command is refused by the engine.
- **`--allow-write` is the opt-in** (`--yes` is accepted as an alias). It switches to `manual` with an approver that answers yes to `workspaceWrite`, `processExec` and `environmentChange`.
- **`destructive` and `credentialSensitive` are never auto-approved**, in any configuration: they have no channel, so they fail closed. A CI flag must not authorise what a human cannot be asked about.
- **Keys come from the environment only**: set `YISI_API_KEY` (or name another variable with `--api-key-env`). Keys are never command-line arguments, so they stay out of shell history and process listings. `YISI_BASE_URL` / `YISI_MODEL` optionally override the endpoint and model.
- `--json` streams **NDJSON**: one event per line as it happens (`tool`, `delta`), with the `result` object always last — so a CI job can show progress on a long run and still parse the final line for the outcome. Without it you get human-readable text.
- Exit codes: **0** the task completed, **1** the task stopped (the reason goes to stderr), **2** bad arguments or missing configuration.
- Tooling that only exists in the editor — language-server symbols, the idle diagnostics snapshot — is not available headless. There is no language server in a CI container to ask.
- One thing worth knowing about the stream: a **refused** call reports a single `failed` event and no `call` event, because nothing ran. The summary says which refusal it was (`policy`, `user`, `hook`, `unavailable`), so a CI log explains itself.
- Not implemented yet: session persistence, multi-task orchestration, and a VSIX `bin` entry point.

## 4. Useful commands

`Yisi AI: New Chat`, `Model Settings`, `Stop Current Run`, `Continue`, `Explain/Add Comments/Unit Tests` (selection), `Generate README / API Docs`, `Show Edit Journal / Undo`, `Open Chat` (status bar / editor title), `Resume`.

Agent tools: `read_file`, `list_directory`, `search_text`, `repo_index`, `replace_text`, `create_text_file`, `rewrite_text_file`, `delete_file`, `rename_file`, `create_directory`, `undo_last_edit`, `run_command`, `git_status`, `git_worktree`, `inspect_project`, `run_validations`, `list_symbols`, `ruyi_check`, `ruyi_manage`, `ruyi_workflow`, `plan_todo`, `session_history`, `model_capabilities`, `request_permission`（请求把本次运行的模式放宽一次；Plan 模式下用它来申请应用已给出的方案，需用户批准，且只对本次运行生效）。

## 5. Configuration

See `package.json` → `contributes.configuration`:
- `yisiAI.defaultProvider` / `yisiAI.defaultModel` — fallback model selection.
- `yisiAI.identityBypassEnabled` / `identityBypassKeywords` — truthful bare-answer path for identity questions.
- `yisiAI.pdfVisionMaxPages` — scanned-PDF image pages for vision models.
- `yisiAI.modelContextWindows` — per-model context-window overrides for the usage ring.

Runtime context safety (v0.7): history is compacted to a configurable fraction of the model window; `repo_index`/`run_command` outputs are bounded; provider errors are secret-redacted.

## 6. Maintenance & upgrade

- **Upgrade**: replace the `.vsix` with a new version (same install path). Persisted sessions use schema v1; `parseSessionDocument` rejects an unknown future schema rather than silently misloading.
- **Security**: secrets are in SecretStorage and redacted from logs/errors (v0.9). Never commit a `.env`/key.
- **Licensing**: any new runtime dependency must be added to `THIRD_PARTY_NOTICES.md` (enforced by `test/dependency-notices.test.js`).
- **Diagnostics**: extension-host errors appear in the Output channel; session errors surface as red bubbles in the chat; the stall notice tells you to wait or Stop.
- **Git worktrees** (v0.4): write sessions are isolated onto session worktrees, cleaned up on session removal (dirty worktrees refuse removal without force).

## 7. Environment-dependent acceptance (not run on this host)

See `docs/18_COMPATIBILITY_MATRIX.md`: real-cloud networking, real Ruyi/RISC-V fixture workflow, upstream `ruyisdk-vscode-extension` merge + original RuyiSDK regression, Linux LNX-001..020 smoke, VSIX release on the target environment.
