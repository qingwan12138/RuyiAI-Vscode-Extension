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
- persisted user and baseline assistant messages
- active Session restoration after Webview/extension restart
- Session history list and switching
- manual Session rename
- confirmed Session deletion with blank-session fallback
- runtime validation for all Webview-to-host messages

## Deliberately not implemented yet

- real LLM request
- model picker popup
- real permission selector
- @file/@folder/@symbol picker
- Agent tool cards
- diff UI
- plan/todo
- terminal UI
- Ruyi environment cards

These must be added according to the architecture milestones instead of faked in the UI layer.

The persisted baseline assistant notice is explicitly labelled as a non-provider response. It verifies the durable UI/host pipeline without pretending that an LLM or Agent run succeeded.

## Visual principle

The welcome page should be restrained and VS Code-native.

The Ruyi logo is a brand anchor, not a giant hero image.

Claude Code/Codex can be referenced for information hierarchy, but exact visual copying is prohibited.
