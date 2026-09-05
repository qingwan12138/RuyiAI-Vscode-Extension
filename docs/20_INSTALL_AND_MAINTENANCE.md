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

## 4. Useful commands

`Yisi AI: New Chat`, `Model Settings`, `Stop Current Run`, `Continue`, `Explain/Add Comments/Unit Tests` (selection), `Generate README / API Docs`, `Show Edit Journal / Undo`, `Open Chat` (status bar / editor title), `Resume`.

Agent tools: `read_file`, `list_directory`, `search_text`, `repo_index`, `replace_text`, `create_text_file`, `rewrite_text_file`, `delete_file`, `rename_file`, `create_directory`, `undo_last_edit`, `run_command`, `git_status`, `git_worktree`, `inspect_project`, `run_validations`, `list_symbols`, `ruyi_check`, `ruyi_manage`, `ruyi_workflow`, `plan_todo`, `session_history`, `model_capabilities`.

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
