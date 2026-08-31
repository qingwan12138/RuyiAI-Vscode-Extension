# 20 — UI Runnable Implementation

## v0.8 purpose

v0.8 replaces the previous engineering placeholder Webview with an actual product-direction welcome UI.

This is still not the final visual design, but it is now an executable UI baseline rather than a static HTML mockup.

## Implemented

- real `YisiChatViewProvider` renders the welcome screen
- Ruyi logo loaded through `webview.asWebviewUri`
- compact session header
- new-session action
- centered Yisi/Ruyi brand area
- four first-version quick actions
- bottom composer
- add-context placeholder
- model selector entry
- permission-mode entry
- send button
- Enter-to-send / Shift+Enter newline
- theme variables
- responsive narrow-sidebar behavior
- draft user-message rendering
- extension-host message round trip
- versioned local Session persistence under VS Code global storage
- persisted user messages and completed provider responses
- active Session restoration after Webview/extension restart
- Session history list and switching
- manual Session rename
- confirmed Session deletion with blank-session fallback
- runtime validation for all Webview-to-host messages
- OpenAI and custom OpenAI-compatible provider setup wizard
- API-key SecretStorage, environment-variable, and credential-free local modes
- provider model discovery with timeout and explicit manual fallback
- per-session model selection and workspace default
- streamed assistant response rendering through `textContent`
- Send/Stop run-state control with AbortSignal propagation
- partial provider output discarded on failure or Stop
- session/model switching blocked while a provider run is active
- workspace-scoped file picker behind the Composer `＋` action
- removable pending file-context chips
- persisted file references on user messages without persisting raw file content
- explicit attached content included only in the next provider request

## Deliberately not implemented yet

- richer per-action permission/diff review surface (the real Session permission selector and Manual native edit confirmation are implemented)
- @folder/@symbol picker and inline `@` search
- Agent tool cards
- diff UI
- plan/todo
- terminal UI
- Ruyi environment cards

These must be added according to the architecture milestones instead of faked in the UI layer. The current provider path is real chat transport and can run bounded Read/List/Search plus stale-safe unique text replacement when tool calling is explicitly enabled. It still cannot run commands, create/delete files, show a complete diff card, or automatically validate an edit.

Automated transport verification uses a local fake OpenAI-compatible HTTP/SSE server. A real user cloud credential was not used during repository verification.

## Visual principle

The welcome page should be restrained and VS Code-native.

The Ruyi logo is a brand anchor, not a giant hero image.

Claude Code/Codex can be referenced for information hierarchy, but exact visual copying is prohibited.
