# 21 — Theme-Adaptive Ruyi Mark

## Decision

The welcome screen no longer inserts the supplied white-background PNG directly.

The supplied Ruyi artwork is split into two transparent masks:

- `media/ruyi-primary-mask.png`
- `media/ruyi-accent-mask.png`

The Webview renders them as CSS mask layers.

## Theme behavior

Primary linework:

```css
background-color: var(--vscode-foreground);
```

Therefore it automatically follows VS Code Dark/Light themes.

Accent linework keeps the Ruyi yellow brand accent.

For VS Code high-contrast themes, both layers use `var(--vscode-foreground)` to prioritize accessibility.

## Why CSS masks instead of a white PNG

- no white square/background
- integrates with VS Code theme
- keeps the recognizable Ruyi silhouette
- does not require a second runtime or native image library in the extension
- remains pure Webview HTML/CSS/TypeScript at runtime

## Asset note

`ruyi-logo-transparent.png` is also included as a transparent original-color derivative for non-theme-sensitive contexts. The welcome page should prefer the mask-based mark.

## Rule

Do not reintroduce a white card behind the welcome logo unless a future brand specification explicitly requires it.
