import * as vscode from 'vscode';

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
      overflow: hidden;
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
      overflow: auto;
      display: flex;
      flex-direction: column;
    }

    .welcome {
      flex: 1;
      min-height: 310px;
      padding: 34px 18px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
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
    }

    .quick-action:hover {
      background: var(--yisi-surface-hover);
    }

    .conversation {
      display: none;
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
    }

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

    .composer-wrap {
      padding: 8px 10px 10px;
      background:
        linear-gradient(to bottom, transparent, var(--vscode-sideBar-background) 15%);
    }

    .composer {
      border: 1px solid var(--vscode-input-border, var(--yisi-border));
      border-radius: var(--yisi-radius-lg);
      background: var(--vscode-input-background);
      box-shadow: 0 1px 6px rgba(0,0,0,.08);
      overflow: hidden;
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

    .composer-footer {
      min-height: 38px;
      padding: 4px 5px 5px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .composer-left,
    .composer-right {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 3px;
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

    @media (max-width: 260px) {
      .quick-actions {
        grid-template-columns: 1fr;
      }

      .control-button.model .control-label {
        display: none;
      }

      .welcome {
        padding-left: 12px;
        padding-right: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="session-title" id="sessionTitle">New Chat</div>
      <div class="top-actions">
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
        <div class="composer-footer">
          <div class="composer-left">
            <button class="control-button" id="addContext" type="button" title="Add context">
              <span style="font-size:17px;line-height:1;">＋</span>
            </button>
          </div>
          <div class="composer-right">
            <button class="control-button model" id="modelButton" type="button" title="Choose model">
              <span class="control-label">Model</span>
              <span class="chevron">⌄</span>
            </button>
            <button class="control-button" id="permissionButton" type="button" title="Permission mode">
              <span class="control-label">Plan</span>
              <span class="chevron">⌄</span>
            </button>
            <button class="send-button" id="sendButton" type="button" aria-label="Send" disabled>↑</button>
          </div>
        </div>
      </div>
      <div class="status-line" id="status" aria-live="polite"></div>
    </footer>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const input = document.getElementById('promptInput');
    const sendButton = document.getElementById('sendButton');
    const status = document.getElementById('status');
    const welcome = document.getElementById('welcome');
    const conversation = document.getElementById('conversation');
    const sessionTitle = document.getElementById('sessionTitle');
    const historyPanel = document.getElementById('historyPanel');
    const historyList = document.getElementById('historyList');
    let sessionSummaries = [];
    let activeSession;

    function updateSendState() {
      sendButton.disabled = input.value.trim().length === 0;
    }

    function resizeInput() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    }

    function showHistory(visible) {
      historyPanel.hidden = !visible;
      welcome.style.display = visible || (activeSession && activeSession.items.length > 0) ? 'none' : '';
      conversation.classList.toggle('visible', !visible && !!activeSession && activeSession.items.length > 0);
      if (visible) renderHistory();
    }

    function renderHistory() {
      historyList.replaceChildren();
      sessionSummaries.forEach(summary => {
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
        rename.addEventListener('click', () => {
          const nextTitle = window.prompt('Rename session', summary.title || 'New Chat');
          if (nextTitle && nextTitle.trim()) {
            vscode.postMessage({ type: 'renameSession', sessionId: summary.id, title: nextTitle });
            status.textContent = 'Renaming session…';
          }
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button';
        remove.title = 'Delete session';
        remove.setAttribute('aria-label', 'Delete ' + (summary.title || 'session'));
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          if (window.confirm('Delete this session and its saved messages?')) {
            vscode.postMessage({ type: 'deleteSession', sessionId: summary.id, confirmed: true });
            status.textContent = 'Deleting session…';
          }
        });

        actions.append(rename, remove);
        row.append(select, actions);
        historyList.appendChild(row);
      });
    }

    function renderActiveSession() {
      if (!activeSession) return;
      sessionTitle.textContent = activeSession.title || 'New Chat';
      conversation.replaceChildren();

      activeSession.items.forEach(item => {
        const node = document.createElement('div');
        node.className = 'message ' + (item.type === 'userMessage' ? 'user' : 'system');
        node.textContent = item.text;
        conversation.appendChild(node);
      });

      showHistory(false);
      const content = document.getElementById('content');
      content.scrollTop = content.scrollHeight;
    }

    function submit() {
      const text = input.value.trim();
      if (!text) return;

      vscode.postMessage({ type: 'sendMessage', text });

      input.value = '';
      resizeInput();
      updateSendState();
      status.textContent = 'Saving message…';
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

    document.getElementById('closeHistory').addEventListener('click', () => showHistory(false));

    document.getElementById('modelButton').addEventListener('click', () => {
      vscode.postMessage({ type: 'selectModel' });
    });

    document.getElementById('permissionButton').addEventListener('click', () => {
      vscode.postMessage({ type: 'selectPermission' });
    });

    document.getElementById('addContext').addEventListener('click', () => {
      vscode.postMessage({ type: 'addContext' });
    });

    document.querySelectorAll('.quick-action').forEach(button => {
      button.addEventListener('click', () => {
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
        renderActiveSession();
        renderHistory();
        status.textContent = '';
        input.focus();
      }

      if (message.type === 'sessionError') {
        status.textContent = message.message || 'Session action failed.';
      }

      if (message.type === 'runStopped') {
        status.textContent = 'Stopped';
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
