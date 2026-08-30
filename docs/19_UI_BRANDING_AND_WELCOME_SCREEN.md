# 19 — Yisi AI UI Branding & Welcome Screen Contract

## 1. Branding decision

Yisi AI should visually belong to the RuyiSDK ecosystem.

The welcome / empty-session page must use the **Ruyi logo** as the central brand visual.

Current approved asset:
`media/ruyi-logo.png`

Do not invent an unrelated AI mascot as the primary visual identity.

## 2. Reference policy

Claude Code may be used as a **product layout and interaction reference**, especially for:

- top session header
- large calm empty-state area
- central brand/mascot location
- bottom-fixed composer
- model / permission controls near the composer
- lightweight status messaging
- progressive disclosure

But Yisi AI MUST NOT:

- copy Claude Code proprietary branding
- copy Claude mascot/pixel art
- copy exact typography, spacing, iconography, wording, or colors
- reproduce the UI pixel-for-pixel
- present itself as Claude Code

Principle:

> Learn interaction structure; create an independent Ruyi/Yisi visual system.


## 2.1 Sidebar top-bar rule

The Webview must not show an extra `Yisi AI` title row above the session navigation.

The visible top of the Yisi AI sidebar should start directly with:

```text
New Chat / Session title                         history   +
──────────────────────────────────────────────────────────
```

The `Yisi AI` product name belongs in the central welcome brand area, not in a redundant top header.

## 3. Welcome screen layout

Recommended first-version structure:

```text
┌─────────────────────────────────────────┐
│ Session title                    History│
├─────────────────────────────────────────┤
│                                         │
│                 Yisi AI                 │
│                                         │
│              [ Ruyi Logo ]              │
│                                         │
│        RuyiSDK intelligent coding       │
│                                         │
│     optional environment status area    │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│  Ask Yisi to work on your project...    │
│                                         │
│  +   context   model   permission    ↑  │
└─────────────────────────────────────────┘
```

The page should feel sparse and calm when no conversation exists.

## 4. Ruyi logo usage

The Ruyi logo can be used for:

- welcome / empty session
- first-run onboarding
- loading/thinking placeholder in limited contexts
- Ruyi-specific operation cards
- About / product identity

Avoid excessive repetition inside every assistant message.

The logo must keep its aspect ratio.

Do not:
- stretch
- recolor casually
- crop into an unrecognizable shape
- place on a background that destroys contrast

## 5. Brand hierarchy

Recommended hierarchy:

```text
RuyiSDK ecosystem
      ↓
Yisi AI
      ↓
Coding Agent + Ruyi intelligent workflows
```

The UI should make it obvious that Yisi AI is an intelligent development capability for the RuyiSDK ecosystem rather than an unrelated general chatbot.

## 6. Empty-session content

Initial wording can be neutral and product-specific, for example:

- `Yisi AI`
- `RuyiSDK intelligent coding assistant`
- `Ask Yisi to analyze, build, fix, or configure this project.`

Avoid borrowing Claude Code wording.

## 7. Composer direction

The bottom composer should reserve these areas from the beginning:

- text input
- add/context button
- active context chips
- model selector
- permission mode selector
- send / stop button

Future additions can include:
- plan mode indicator
- token/context indicator
- worktree indicator
- Ruyi environment indicator

Do not overload v0.1.

## 8. Session header

Reserve:
- session title
- history/session switcher
- new session
- optional task status

The header should not be tightly coupled to provider branding.

## 9. Ruyi-specific status area

Future welcome screen may show compact local environment status:

```text
Ruyi: detected
Toolchain: configured
Venv: active
Git: clean
```

This is optional and should not block initial UI delivery.

## 10. Theme support

The Webview must support VS Code light/dark/high-contrast themes through VS Code CSS variables where possible.

Do not hardcode a full independent dark theme that clashes with VS Code.

The logo itself may remain the approved brand asset.

## 11. Accessibility

- meaningful `alt` text for the logo
- keyboard-focusable controls
- visible focus states
- no color-only status semantics
- sufficient contrast
- composer usable without mouse

## 12. Architecture boundary

Webview owns presentation only.

It MUST NOT directly:
- access secrets
- spawn commands
- call Ruyi CLI
- modify files
- execute Git
- make privileged Agent decisions

All actions go through typed Webview messages to the Extension Host.

## 13. Acceptance criteria

UI-001 Empty session shows Yisi AI + Ruyi logo.
UI-002 Logo keeps aspect ratio.
UI-003 UI works in VS Code dark and light themes.
UI-004 Composer is present at bottom.
UI-005 Model and permission locations are reserved.
UI-006 No Claude Code proprietary visual asset is included.
UI-007 No pixel-for-pixel Claude Code clone.
UI-008 Webview has no privileged backend logic.
UI-009 Branding remains consistent with RuyiSDK.
UI-010 Keyboard navigation remains usable.
