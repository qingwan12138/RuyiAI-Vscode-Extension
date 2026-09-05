import * as vscode from 'vscode';
import {
  modelControlButtonMarkup,
  modelControlClientScript,
  modelControlPopoverMarkup,
  modelControlStyles
} from './modelControlHtml';
import {
  permissionButtonMarkup,
  permissionClientScript,
  permissionPopoverMarkup,
  permissionStyles
} from './permissionHtml';
import { MARKDOWN_RENDERER_SOURCE } from './webviewMarkdown';

export function createChatViewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = createNonce();
    const primaryMaskUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'ruyi-primary-mask.png')
    );
    const accentMaskUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'ruyi-accent-mask.png')
    );

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Yisi AI</title>
  <style>
    :root {
      color-scheme: light dark;
      --yisi-radius-lg: 12px;
      --yisi-radius-md: 8px;
      --yisi-border: color-mix(in srgb, var(--vscode-panel-border) 86%, transparent);
      --yisi-muted: var(--vscode-descriptionForeground);
      --yisi-surface: color-mix(in srgb, var(--vscode-input-background) 88%, transparent);
      --yisi-surface-hover: color-mix(in srgb, var(--vscode-list-hoverBackground) 86%, transparent);
      --yisi-accent: var(--vscode-button-background);
      --yisi-accent-fg: var(--vscode-button-foreground);
      /* Tech-surface variables: all derived from theme colours at low alpha so
         dark/light stay readable; brand yellow keeps the Ruyi accent. */
      --yisi-brand: #f2b51d;
      --yisi-halo: color-mix(in srgb, #f2b51d 10%, transparent);
      --yisi-halo-soft: color-mix(in srgb, #f2b51d 22%, transparent);
      --yisi-grid: color-mix(in srgb, var(--vscode-panel-border) 52%, transparent);
      --yisi-accent-soft: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
    }

    :root {
      color-scheme: light dark;
      /* Content never shrinks below this; a narrower sidebar shows a horizontal
         scrollbar instead of truncating the layout. Tweak to your needs. */
      --yisi-min-width: 320px;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      /* VS Code cannot lock the sidebar width, so we enforce a content floor and
         let the webview scroll horizontally below it instead of clipping. */
      overflow-x: auto;
      overflow-y: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }

    button,
    textarea {
      font: inherit;
    }

    button {
      color: inherit;
    }

    .app {
      height: 100vh;
      width: 100%;
      min-width: var(--yisi-min-width);
      display: grid;
      grid-template-rows: 40px minmax(0, 1fr) auto;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-width: 0;
      padding: 0 8px 0 10px;
      border-bottom: 1px solid var(--yisi-border);
    }

    .session-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .01em;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .icon-button {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--vscode-icon-foreground);
      cursor: pointer;
    }

    .icon-button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .icon-button:focus-visible,
    .control-button:focus-visible,
    .send-button:focus-visible,
    .quick-action:focus-visible,
    .session-select:focus-visible,
    textarea:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .content {
      min-height: 0;
      min-width: 0;
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-gutter: stable;
      display: flex;
      flex-direction: column;
    }

    .content::-webkit-scrollbar {
      width: 8px;
    }

    .content::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,.4));
      border-radius: 4px;
    }

    .welcome {
      position: relative;
      flex: 1;
      min-height: 310px;
      padding: 34px 18px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      overflow: hidden;
    }

    /* Faint engineering grid + soft brand halo behind the central mark. */
    .welcome::before {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(340px 230px at 50% 30%, var(--yisi-halo), transparent 72%),
        repeating-linear-gradient(0deg, var(--yisi-grid) 0 1px, transparent 1px 24px),
        repeating-linear-gradient(90deg, var(--yisi-grid) 0 1px, transparent 1px 24px);
      opacity: .6;
    }

    .welcome > * {
      position: relative;
    }

    .brand-name {
      margin: 0 0 17px;
      font-size: 19px;
      line-height: 1;
      font-weight: 600;
      letter-spacing: .01em;
    }

    .ruyi-mark {
      position: relative;
      width: 94px;
      height: 94px;
      margin-bottom: 18px;
      isolation: isolate;
    }

    /* Thin brand ring that reads like a sensor/retical around the mark. */
    .ruyi-mark::before {
      content: '';
      position: absolute;
      inset: -10px;
      border-radius: 50%;
      border: 1px solid var(--yisi-halo-soft);
      box-shadow: 0 0 26px -8px var(--yisi-halo-soft);
      opacity: .9;
    }

    .ruyi-mark-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      background-color: var(--vscode-foreground);
      -webkit-mask-position: center;
      mask-position: center;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-size: contain;
      mask-size: contain;
    }

    .ruyi-mark-primary {
      opacity: .94;
      -webkit-mask-image: url("${primaryMaskUri}");
      mask-image: url("${primaryMaskUri}");
    }

    .ruyi-mark-accent {
      background-color: #f2b51d;
      -webkit-mask-image: url("${accentMaskUri}");
      mask-image: url("${accentMaskUri}");
    }

    body.vscode-high-contrast .ruyi-mark-accent,
    body.vscode-high-contrast-light .ruyi-mark-accent {
      background-color: var(--vscode-foreground);
    }

    /* High-contrast modes drop the decorative halo/grid/ring entirely. */
    body.vscode-high-contrast .welcome::before,
    body.vscode-high-contrast-light .welcome::before {
      background: none;
    }

    body.vscode-high-contrast .ruyi-mark::before,
    body.vscode-high-contrast-light .ruyi-mark::before {
      display: none;
    }

    .welcome-title {
      margin: 0;
      max-width: 260px;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.45;
    }

    .welcome-subtitle {
      margin: 6px 0 0;
      max-width: 270px;
      color: var(--yisi-muted);
      font-size: 11px;
      line-height: 1.55;
    }

    .quick-actions {
      width: min(100%, 330px);
      margin-top: 24px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }

    .quick-action {
      min-width: 0;
      padding: 8px 9px;
      border: 1px solid var(--yisi-border);
      border-radius: 8px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      text-align: left;
      font-size: 11px;
      line-height: 1.3;
      transition: border-color 120ms ease, background-color 120ms ease;
    }

    .quick-action:hover {
      background: var(--yisi-surface-hover);
      border-color: var(--yisi-accent-soft);
    }

    .conversation {
      display: none;
      min-width: 0;
      max-width: 100%;
      padding: 12px 12px 20px;
    }

    .conversation.visible {
      display: block;
    }

    .message {
      margin: 0 0 10px;
      padding: 9px 10px;
      border-radius: 9px;
      line-height: 1.5;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      min-width: 0;
      max-width: 100%;
    }

    .message > :first-child { margin-top: 0; }
    .message > :last-child { margin-bottom: 0; }

    .message p { margin: 0 0 6px; }
    .message h1, .message h2, .message h3, .message h4, .message h5, .message h6 {
      margin: 8px 0 4px;
      font-size: 1.12em;
      font-weight: 600;
      line-height: 1.3;
    }
    .message code.md-icode {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.14));
      padding: 1px 4px;
      border-radius: 4px;
    }
    .message pre.md-code {
      white-space: pre;
      overflow-x: auto;
      border: 1px solid var(--yisi-border);
      border-radius: 6px;
      padding: 8px;
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.10));
    }
    .message pre.md-code code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; white-space: pre; }
    .message .md-table-wrap { overflow-x: auto; margin: 0 0 6px; }
    .message table { border-collapse: collapse; min-width: 100%; }
    .message th, .message td {
      border: 1px solid var(--yisi-border);
      padding: 4px 6px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .message th { background: var(--yisi-surface-hover); font-weight: 600; }
    .message blockquote.md-quote { margin: 4px 0; padding: 2px 8px; border-left: 2px solid var(--yisi-border); color: var(--yisi-muted); }
    .message hr.md-hr { border: 0; border-top: 1px solid var(--yisi-border); margin: 8px 0; }
    .message a { color: var(--vscode-textLink-foreground); text-decoration: none; word-break: break-all; }

    .message.user {
      margin-left: 22px;
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .message.system {
      border: 1px solid var(--yisi-border);
      color: var(--yisi-muted);
      background: var(--yisi-surface);
    }

    .message.assistant {
      margin-right: 12px;
      border: 1px solid var(--yisi-border);
      background: var(--yisi-surface);
    }

    .message.streaming::after {
      content: '▋';
      margin-left: 2px;
      color: var(--vscode-progressBar-background);
      animation: yisi-cursor 1s steps(1) infinite;
    }

    @keyframes yisi-cursor {
      50% { opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
        transition: none !important;
      }
    }

    .history-panel {
      flex: 1;
      min-height: 0;
      padding: 10px;
      overflow: auto;
      background: var(--vscode-sideBar-background);
    }

    .history-panel[hidden] {
      display: none;
    }

    .history-header {
      min-height: 34px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 2px 8px;
    }

    .history-heading {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
    }

    .history-list {
      display: grid;
      gap: 5px;
    }

    .session-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 3px;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 3px;
    }

    .session-row:hover {
      background: var(--yisi-surface-hover);
    }

    .session-row.active {
      border-color: var(--vscode-focusBorder);
      background: var(--yisi-surface);
    }

    .session-select {
      min-width: 0;
      border: 0;
      border-radius: 5px;
      padding: 6px 7px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      text-align: left;
    }

    .session-select-title,
    .session-select-meta {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-select-title {
      font-size: 11px;
      font-weight: 500;
    }

    .session-select-meta {
      margin-top: 2px;
      color: var(--yisi-muted);
      font-size: 9px;
    }

    .session-actions {
      display: flex;
      gap: 1px;
    }

    .session-edit-input {
      min-width: 0;
      width: 100%;
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 5px;
      padding: 4px 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font: inherit;
      font-size: 11px;
    }

    .session-edit-meta {
      grid-column: 1 / -1;
      color: var(--yisi-muted);
      font-size: 9px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-confirm {
      grid-column: 1 / -1;
      display: grid;
      gap: 3px;
      padding: 2px 4px;
    }

    .session-confirm-title {
      font-size: 11px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-confirm-text {
      color: var(--yisi-muted);
      font-size: 10px;
    }

    .session-confirm-actions {
      display: flex;
      gap: 5px;
      align-items: center;
    }

    .session-confirm-button {
      height: 22px;
      padding: 0 9px;
      border: 1px solid var(--yisi-border);
      border-radius: 5px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 10px;
    }

    .session-confirm-button.danger {
      border-color: #c0392b;
      color: var(--vscode-editorError-foreground, #c0392b);
    }

    .composer-wrap {
      padding: 8px 10px 10px;
      background:
        linear-gradient(to bottom, transparent, var(--vscode-sideBar-background) 15%);
    }

    .composer {
      min-width: 0;
      max-width: 100%;
      border: 1px solid var(--vscode-input-border, var(--yisi-border));
      border-radius: var(--yisi-radius-lg);
      background: var(--vscode-input-background);
      box-shadow: 0 1px 6px rgba(0,0,0,.08);
      overflow: hidden;
    }

    .composer:focus-within {
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 72%, transparent);
      box-shadow: 0 0 0 2px var(--yisi-accent-soft);
    }

    .composer textarea {
      display: block;
      width: 100%;
      min-height: 58px;
      max-height: 180px;
      resize: none;
      padding: 11px 12px 5px;
      border: 0;
      outline: 0;
      color: var(--vscode-input-foreground);
      background: transparent;
      line-height: 1.45;
    }

    .composer textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .context-chips {
      padding: 0 8px 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .context-chips:empty {
      display: none;
    }

    .context-chip {
      max-width: 100%;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 4px 3px 8px;
      border: 1px solid var(--yisi-border);
      border-radius: 999px;
      background: var(--yisi-surface);
      color: var(--yisi-muted);
      font-size: 10px;
      line-height: 1;
    }

    .context-chip.ready {
      border-color: var(--yisi-border);
    }

    .context-chip.warning {
      border-color: #b58900;
      color: var(--vscode-editorWarning-foreground, #b58900);
    }

    .context-chip.unsupported,
    .context-chip.error {
      border-color: #c0392b;
      color: var(--vscode-editorError-foreground, #c0392b);
    }

    .chip-kind {
      flex: none;
      font-weight: 600;
      opacity: .75;
      text-transform: uppercase;
    }

    .chip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chip-msg {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: .85;
    }

    .chip-remove {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 14px;
      height: 14px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      opacity: .7;
    }

    .chip-remove:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }

    .chip-clear {
      align-self: center;
      padding: 2px 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--yisi-muted);
      font-size: 10px;
      cursor: pointer;
    }

    .chip-clear:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground);
    }

    .message-context {
      margin-top: 5px;
      opacity: .82;
      font-size: 10px;
    }

    .composer-footer {
      min-height: 38px;
      padding: 4px 5px 5px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
    }

    .composer-left,
    .composer-right {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 3px;
    }

    /* Circular context-usage gauge (donut via conic-gradient + inner hole). */
    .ctx-ring {
      flex: none;
      position: relative;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--yisi-border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: conic-gradient(var(--yisi-accent) 0%, var(--yisi-border) 0);
      color: var(--vscode-foreground);
      cursor: default;
    }

    .ctx-ring::before {
      content: '';
      position: absolute;
      inset: 4px;
      border-radius: 50%;
      background: var(--vscode-input-background, var(--vscode-sideBar-background));
    }

    .ctx-ring.unknown {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .control-button {
      max-width: 115px;
      height: 28px;
      padding: 0 8px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--yisi-muted);
      cursor: pointer;
      font-size: 11px;
      white-space: nowrap;
    }

    .control-button:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground);
    }

    .control-label {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .send-button {
      width: 28px;
      height: 28px;
      display: inline-grid;
      place-items: center;
      border: 0;
      border-radius: 7px;
      background: var(--yisi-accent);
      color: var(--yisi-accent-fg);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
    }

    .send-button:disabled {
      opacity: .45;
      cursor: default;
    }

    .status-line {
      min-height: 16px;
      padding: 2px 3px 0;
      color: var(--yisi-muted);
      font-size: 10px;
      line-height: 1.35;
    }

    .chevron {
      opacity: .72;
      font-size: 9px;
    }

    @media (max-width: 360px) {
      .composer-footer {
        padding: 4px 3px 4px;
      }

      .composer-left,
      .composer-right {
        gap: 2px;
      }

      .control-button {
        padding: 0 6px;
        max-width: none;
      }

      .conversation {
        padding-left: 8px;
        padding-right: 8px;
      }

      .message {
        padding: 7px 8px;
      }
    }

    @media (max-width: 300px) {
      .ruyi-mark {
        width: 76px;
        height: 76px;
      }

      .welcome {
        padding-left: 10px;
        padding-right: 10px;
      }
    }

    @media (max-width: 260px) {
      .quick-actions {
        grid-template-columns: 1fr;
      }

      .welcome {
        padding-left: 12px;
        padding-right: 12px;
      }
    }
  ${modelControlStyles()}
  ${permissionStyles()}
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="session-title" id="sessionTitle">New Chat</div>
      <div class="top-actions">
        <button class="icon-button" id="homeButton" type="button" title="Back to main screen" aria-label="Back to main screen">⌂</button>
        <button class="icon-button" id="historyButton" type="button" title="Session history" aria-label="Session history">◷</button>
        <button class="icon-button" id="newChat" type="button" title="New session" aria-label="New session">＋</button>
      </div>
    </header>

    <main class="content" id="content">
      <section class="history-panel" id="historyPanel" aria-label="Session history" hidden>
        <div class="history-header">
          <h2 class="history-heading">Session history</h2>
          <button class="icon-button" id="closeHistory" type="button" title="Close history" aria-label="Close history">×</button>
        </div>
        <div class="history-list" id="historyList"></div>
      </section>

      <section class="welcome" id="welcome">
        <h1 class="brand-name">Yisi AI</h1>

        <div class="ruyi-mark" role="img" aria-label="Ruyi logo">
          <span class="ruyi-mark-layer ruyi-mark-primary"></span>
          <span class="ruyi-mark-layer ruyi-mark-accent"></span>
        </div>

        <p class="welcome-title">RuyiSDK intelligent coding agent</p>
        <p class="welcome-subtitle">Analyze, modify, build and validate your project with Ruyi-aware workflows.</p>

        <div class="quick-actions" aria-label="Quick actions">
          <button class="quick-action" type="button" data-prompt="分析当前项目">分析当前项目</button>
          <button class="quick-action" type="button" data-prompt="修复当前编译错误">修复编译错误</button>
          <button class="quick-action" type="button" data-prompt="配置 Ruyi 开发环境">配置 Ruyi 环境</button>
          <button class="quick-action" type="button" data-prompt="运行构建与测试">运行构建与测试</button>
        </div>
      </section>

      <section class="conversation" id="conversation" aria-live="polite"></section>
    </main>

    <footer class="composer-wrap">
      <div class="composer">
        <textarea id="promptInput" rows="1" placeholder="Ask Yisi to work on your project..." aria-label="Message Yisi AI"></textarea>
        <div class="context-chips" id="contextChips" aria-label="Attached context"></div>
        <div class="composer-footer">
          <div class="composer-left">
            <span class="ctx-ring" id="ctxRing" title="上下文已用：—"></span>
            <button class="control-button" id="addContext" type="button" title="Add context">
              <span style="font-size:17px;line-height:1;">＋</span>
            </button>
          </div>
          <div class="composer-right">
            ${modelControlButtonMarkup()}
            ${permissionButtonMarkup()}
            <button class="send-button" id="sendButton" type="button" aria-label="Send" disabled>↑</button>
          </div>
        </div>
      </div>
      <div class="status-line" id="status" aria-live="polite"></div>
      ${modelControlPopoverMarkup()}
      ${permissionPopoverMarkup()}
    </footer>
  </div>

  <script nonce="${nonce}">
${modelControlClientScript()}
  </script>

  <script nonce="${nonce}">
${permissionClientScript()}
  </script>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const modelControl = createYisiModelControl(vscode);
    const permissionControl = createYisiPermissionControl(vscode);

    const input = document.getElementById('promptInput');
    const sendButton = document.getElementById('sendButton');
    const status = document.getElementById('status');
    const welcome = document.getElementById('welcome');
    const conversation = document.getElementById('conversation');
    const sessionTitle = document.getElementById('sessionTitle');
    const historyPanel = document.getElementById('historyPanel');
    const historyList = document.getElementById('historyList');
    const contextChips = document.getElementById('contextChips');
    let sessionSummaries = [];
    let activeSession;
    let isRunning = false;
    let transientAssistant;
    let streamedText = '';
    // Pure Webview UI state: which session row is being renamed inline or asked
    // to confirm deletion. Never written back into the Session domain.
    let editingSessionId = null;
    let confirmDeleteSessionId = null;
    // 'welcome' (main screen) or 'conversation'. Starts at 'welcome' so the
    // extension always opens on the main screen, never dropping straight into
    // the previous conversation. A home/back action returns here.
    let viewMode = 'welcome';

    function updateSendState() {
      sendButton.disabled = !isRunning && input.value.trim().length === 0;
      sendButton.textContent = isRunning ? '■' : '↑';
      sendButton.setAttribute('aria-label', isRunning ? 'Stop' : 'Send');
      sendButton.title = isRunning ? 'Stop current run' : 'Send message';
      input.disabled = isRunning;
    }

    function resizeInput() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    }

    function renderView() {
      const showConversation = viewMode === 'conversation' && !!activeSession && activeSession.items.length > 0;
      welcome.style.display = showConversation ? 'none' : '';
      conversation.classList.toggle('visible', showConversation);
    }

    function showHistory(visible) {
      historyPanel.hidden = !visible;
      if (visible) {
        // History overlays the main content; keep the welcome/conversation hidden.
        welcome.style.display = 'none';
        conversation.classList.remove('visible');
        renderHistory();
        return;
      }
      renderView();
    }

    function renderHistory() {
      historyList.replaceChildren();
      sessionSummaries.forEach(summary => {
        if (summary.id === editingSessionId) {
          historyList.appendChild(renderEditingRow(summary));
          return;
        }
        if (summary.id === confirmDeleteSessionId) {
          historyList.appendChild(renderConfirmRow(summary));
          return;
        }
        historyList.appendChild(renderSessionRow(summary));
      });
    }

    function renderSessionRow(summary) {
      const row = document.createElement('div');
      row.className = 'session-row' + (summary.active ? ' active' : '');

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'session-select';
      select.setAttribute('aria-current', summary.active ? 'page' : 'false');
      const title = document.createElement('span');
      title.className = 'session-select-title';
      title.textContent = summary.title || 'New Chat';
      const meta = document.createElement('span');
      meta.className = 'session-select-meta';
      meta.textContent = new Date(summary.updatedAt).toLocaleString();
      select.append(title, meta);
      select.addEventListener('click', () => {
        viewMode = 'conversation';
        vscode.postMessage({ type: 'switchSession', sessionId: summary.id });
        status.textContent = 'Switching session…';
      });

      const actions = document.createElement('div');
      actions.className = 'session-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'icon-button';
      rename.title = 'Rename session';
      rename.setAttribute('aria-label', 'Rename ' + (summary.title || 'session'));
      rename.textContent = '✎';
      rename.addEventListener('click', event => {
        event.stopPropagation();
        beginRename(summary);
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button';
      remove.title = 'Delete session';
      remove.setAttribute('aria-label', 'Delete ' + (summary.title || 'session'));
      remove.textContent = '🗑';
      remove.addEventListener('click', event => {
        event.stopPropagation();
        beginDelete(summary);
      });

      actions.append(rename, remove);
      row.append(select, actions);
      return row;
    }

    function renderEditingRow(summary) {
      const row = document.createElement('div');
      row.className = 'session-row' + (summary.active ? ' active' : '');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-edit-input';
      input.value = summary.title || 'New Chat';
      input.setAttribute('aria-label', 'Session title');
      input.addEventListener('click', event => event.stopPropagation());
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitRename(summary, input.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelRename();
        }
      });
      // Clicking the in-row save/cancel buttons prevents default on mousedown so
      // the input keeps focus and this blur only fires when the user clicks away,
      // which reverts without submitting (no double renameSession).
      input.addEventListener('blur', () => {
        if (editingSessionId === summary.id) cancelRename();
      });

      const actions = document.createElement('div');
      actions.className = 'session-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'icon-button';
      save.title = 'Save';
      save.setAttribute('aria-label', 'Save session title');
      save.textContent = '✓';
      save.addEventListener('mousedown', event => event.preventDefault());
      save.addEventListener('click', event => {
        event.stopPropagation();
        commitRename(summary, input.value);
      });

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'icon-button';
      cancel.title = 'Cancel';
      cancel.setAttribute('aria-label', 'Cancel rename');
      cancel.textContent = '×';
      cancel.addEventListener('mousedown', event => event.preventDefault());
      cancel.addEventListener('click', event => {
        event.stopPropagation();
        cancelRename();
      });

      actions.append(save, cancel);

      const meta = document.createElement('div');
      meta.className = 'session-edit-meta';
      meta.textContent = new Date(summary.updatedAt).toLocaleString();

      row.append(input, actions, meta);
      return row;
    }

    function renderConfirmRow(summary) {
      const row = document.createElement('div');
      row.className = 'session-row' + (summary.active ? ' active' : '');

      const confirm = document.createElement('div');
      confirm.className = 'session-confirm';

      const title = document.createElement('div');
      title.className = 'session-confirm-title';
      title.textContent = summary.title || 'New Chat';

      const text = document.createElement('div');
      text.className = 'session-confirm-text';
      text.textContent = 'Delete this chat?';

      const actions = document.createElement('div');
      actions.className = 'session-confirm-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'session-confirm-button';
      cancel.textContent = 'Cancel';
      cancel.title = 'Cancel delete';
      cancel.addEventListener('click', event => {
        event.stopPropagation();
        cancelDelete();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'session-confirm-button danger';
      del.textContent = 'Delete';
      del.title = 'Delete session';
      del.addEventListener('click', event => {
        event.stopPropagation();
        confirmDeleteSessionId = null;
        vscode.postMessage({ type: 'deleteSession', sessionId: summary.id, confirmed: true });
        status.textContent = 'Deleting session…';
      });

      actions.append(cancel, del);
      confirm.append(title, text, actions);
      row.append(confirm);
      return row;
    }

    function beginRename(summary) {
      confirmDeleteSessionId = null;
      editingSessionId = summary.id;
      renderHistory();
      const input = historyList.querySelector('.session-edit-input');
      if (input) {
        input.focus();
        input.select();
      }
    }

    function beginDelete(summary) {
      editingSessionId = null;
      confirmDeleteSessionId = summary.id;
      renderHistory();
    }

    function commitRename(summary, rawTitle) {
      if (editingSessionId !== summary.id) return;
      const title = rawTitle.trim();
      editingSessionId = null;
      if (title.length > 0) {
        vscode.postMessage({ type: 'renameSession', sessionId: summary.id, title });
        status.textContent = 'Renaming session…';
      }
      renderHistory();
    }

    function cancelRename() {
      if (!editingSessionId) return;
      editingSessionId = null;
      renderHistory();
    }

    function cancelDelete() {
      if (!confirmDeleteSessionId) return;
      confirmDeleteSessionId = null;
      renderHistory();
    }

    function renderActiveSession() {
      if (!activeSession) return;
      sessionTitle.textContent = activeSession.title || 'New Chat';
      conversation.replaceChildren();
      transientAssistant = undefined;
      streamedText = '';

      activeSession.items.forEach(item => {
        const node = appendMessage(
          item.text,
          item.type === 'userMessage' ? 'user' : (item.source === 'provider' ? 'assistant' : 'system')
        );
        if (item.type === 'userMessage' && Array.isArray(item.contexts) && item.contexts.length > 0) {
          const contextMeta = document.createElement('div');
          contextMeta.className = 'message-context';
          contextMeta.textContent = item.contexts.map(context => '@' + context.path).join(' · ');
          node.appendChild(contextMeta);
        }
      });

      showHistory(false);
      renderView();
      const content = document.getElementById('content');
      content.scrollTop = content.scrollHeight;
    }

    function appendMessage(text, role, streaming) {
      const node = document.createElement('div');
      node.className = 'message ' + role + (streaming ? ' streaming' : '');
      renderMessageBody(node, text, role, streaming);
      conversation.appendChild(node);
      welcome.style.display = 'none';
      conversation.classList.add('visible');
      const content = document.getElementById('content');
      content.scrollTop = content.scrollHeight;
      return node;
    }

    // Safe, minimal Markdown rendering for assistant messages: HTML is escaped
    // first, then a small transform adds headings/bold/inline-code/lists/
    // tables/code blocks. No external dependency, no raw HTML injection.
    function renderMessageBody(node, text, role, streaming) {
      if (role === 'assistant' && !streaming) {
        node.innerHTML = safeMarkdown(text);
      } else {
        node.textContent = text;
      }
    }

    ${MARKDOWN_RENDERER_SOURCE}

    function updateContextRing(usage) {
      const ring = document.getElementById('ctxRing');
      if (!ring) return;
      // The ring is always visible; without a known model/context window it
      // degrades to a grey ring instead of hiding. Only the fill represents the
      // percentage — no numbers inside, and the hover title just says the
      // percent used (no raw token counts).
      if (!usage) {
        ring.classList.add('unknown');
        ring.style.background = 'conic-gradient(var(--yisi-accent) 0%, var(--yisi-border) 0)';
        ring.title = '选择模型后显示上下文用量';
        return;
      }
      if (!usage.supported) {
        ring.classList.add('unknown');
        ring.style.background = 'conic-gradient(var(--yisi-accent) 0%, var(--yisi-border) 0)';
        ring.title = '上下文窗口未知';
        return;
      }
      ring.classList.remove('unknown');
      const percent = Math.max(0, Math.min(100, usage.percent));
      ring.style.background = 'conic-gradient(var(--yisi-accent) ' + percent + '%, var(--yisi-border) 0)';
      ring.title = '上下文已用 ' + percent + '%';
    }

    function renderContexts(contexts) {
      contextChips.replaceChildren();
      const list = Array.isArray(contexts) ? contexts : [];
      if (list.length === 0) return;
      list.forEach(attachment => {
        if (!attachment || typeof attachment.name !== 'string') return;
        const chip = document.createElement('span');
        chip.className = 'context-chip ' + attachmentStatus(attachment);

        const kind = document.createElement('span');
        kind.className = 'chip-kind';
        kind.textContent = kindGlyph(attachment.kind);

        const name = document.createElement('span');
        name.className = 'chip-name';
        name.textContent = '@ ' + attachment.name;

        chip.append(kind, name);
        if (attachment.message) {
          const message = document.createElement('span');
          message.className = 'chip-msg';
          message.textContent = attachment.message;
          chip.appendChild(message);
        }
        chip.title = attachmentTitle(attachment);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'chip-remove';
        remove.setAttribute('aria-label', 'Remove ' + attachment.name);
        remove.title = 'Remove';
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          if (attachment.id) vscode.postMessage({ type: 'removeAttachment', attachmentId: attachment.id });
        });
        chip.appendChild(remove);
        contextChips.appendChild(chip);
      });

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'chip-clear';
      clear.textContent = 'Clear';
      clear.title = 'Remove all attached files';
      clear.addEventListener('click', () => vscode.postMessage({ type: 'clearContext' }));
      contextChips.appendChild(clear);
    }

    function attachmentStatus(attachment) {
      const status = attachment.status || 'ready';
      return status === 'loading' ? 'warning' : status;
    }

    function kindGlyph(kind) {
      const glyphs = {
        text: 'txt', code: '<>', markdown: 'md', pdf: 'pdf',
        document: 'doc', presentation: 'ppt', spreadsheet: 'xls',
        notebook: 'nb', image: 'img', archive: 'zip', unsupported: 'bin'
      };
      return glyphs[kind] || 'file';
    }

    function attachmentTitle(attachment) {
      const label = attachment.location === 'external'
        ? (attachment.relativePath || attachment.name) + ' (external · read-only)'
        : attachment.relativePath || attachment.name;
      const details = [
        label,
        attachment.message
      ].filter(value => value && typeof value === 'string');
      return details.join(' — ');
    }

    function submit() {
      if (isRunning) {
        vscode.postMessage({ type: 'stop' });
        status.textContent = 'Stopping…';
        return;
      }
      const text = input.value.trim();
      if (!text) return;

      viewMode = 'conversation';
      appendMessage(text, 'user', false);
      vscode.postMessage({ type: 'sendMessage', text });

      input.value = '';
      resizeInput();
      updateSendState();
      status.textContent = 'Starting…';
    }

    input.addEventListener('input', () => {
      updateSendState();
      resizeInput();
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    sendButton.addEventListener('click', submit);

    document.getElementById('newChat').addEventListener('click', () => {
      vscode.postMessage({ type: 'newChat' });
    });

    document.getElementById('historyButton').addEventListener('click', () => {
      showHistory(historyPanel.hidden);
    });

    document.getElementById('homeButton').addEventListener('click', () => {
      viewMode = 'welcome';
      showHistory(false);
      input.focus();
    });

    document.getElementById('closeHistory').addEventListener('click', () => showHistory(false));

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && confirmDeleteSessionId) {
        cancelDelete();
      }
    });

    document.getElementById('addContext').addEventListener('click', () => {
      vscode.postMessage({ type: 'addContext' });
    });

    document.querySelectorAll('.quick-action').forEach(button => {
      button.addEventListener('click', () => {
        viewMode = 'conversation';
        input.value = button.dataset.prompt || '';
        resizeInput();
        updateSendState();
        input.focus();
      });
    });

    window.addEventListener('message', event => {
      const message = event.data;

      if (message.type === 'sessionState') {
        sessionSummaries = Array.isArray(message.sessions) ? message.sessions : [];
        activeSession = message.activeSession;
        // Drop stale edit/confirm UI state if the session vanished server-side.
        const ids = new Set(sessionSummaries.map(summary => summary.id));
        if (editingSessionId && !ids.has(editingSessionId)) editingSessionId = null;
        if (confirmDeleteSessionId && !ids.has(confirmDeleteSessionId)) confirmDeleteSessionId = null;
        renderActiveSession();
        if (activeSession) permissionControl.setMode(activeSession.permissionMode);
        renderHistory();
        status.textContent = '';
        isRunning = activeSession && activeSession.status === 'running';
        updateSendState();
        input.focus();
      }

      if (message.type === 'modelControl.state') {
        modelControl.updateState(message.state);
      }

      if (message.type === 'assistantStreamStarted') {
        isRunning = true;
        streamedText = '';
        transientAssistant = appendMessage('Thinking…', 'assistant', true);
        status.textContent = 'Generating…';
        updateSendState();
      }

      if (message.type === 'contextState') {
        renderContexts(message.contexts);
      }

      if (message.type === 'contextUsage') {
        updateContextRing(message.usage);
      }

      if (message.type === 'assistantStreamDelta' && transientAssistant) {
        streamedText += typeof message.text === 'string' ? message.text : '';
        transientAssistant.textContent = streamedText;
        const content = document.getElementById('content');
        content.scrollTop = content.scrollHeight;
      }

      if (message.type === 'assistantStreamCompleted') {
        isRunning = false;
        if (transientAssistant) {
          transientAssistant.classList.remove('streaming');
          // Re-render the finished text through the safe Markdown renderer so
          // the reply formats (headings/bold/tables/code) instead of staying raw.
          transientAssistant.innerHTML = safeMarkdown(streamedText);
        }
        status.textContent = '';
        updateSendState();
      }

      if (message.type === 'sessionError') {
        isRunning = false;
        if (transientAssistant) transientAssistant.classList.remove('streaming');
        status.textContent = message.message || 'Session action failed.';
        updateSendState();
      }

      if (message.type === 'runStopped') {
        isRunning = false;
        if (transientAssistant) transientAssistant.remove();
        transientAssistant = undefined;
        status.textContent = 'Stopped';
        updateSendState();
      }

      if (message.type === 'continueRequested') {
        status.textContent = 'Continue requested';
      }
    });

    updateSendState();
    resizeInput();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
