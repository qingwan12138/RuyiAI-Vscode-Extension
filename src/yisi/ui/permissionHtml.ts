// Compact coding-agent style Permission Mode picker: styles, markup, and a
// client-side factory function. chatViewHtml.ts composes these into the chat
// view the same way it composes the model controller. Selecting a mode posts a
// typed `permission.setMode` message to the extension host; the host is the
// single authority for the session permission mode and re-publishes state.
//
// The permission popover deliberately replaces the old native Quick Pick:
// it opens above the composer pill, one row per mode, with the current mode
// marked by a trailing check.

export function permissionStyles(): string {
  return `
    /* ---- Composer permission pill ---- */
    .mode-pill {
      height: 26px;
      max-width: 170px;
      min-width: 0;
      padding: 0 9px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 0;
      border-radius: 999px;
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }

    .mode-pill:hover {
      background: var(--yisi-surface-hover);
    }

    .mode-pill[aria-expanded="true"] {
      background: var(--yisi-surface-hover);
    }

    .mode-pill:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .mode-pill .pill-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mode-pill .pill-chevron {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      opacity: .85;
    }

    /* ---- Popover ---- */
    .permission-popover {
      position: fixed;
      z-index: 60;
      width: 300px;
      max-width: calc(100vw - 16px);
      padding: 4px;
      background: var(--vscode-editorWidget-background, var(--vscode-menu-background));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .18);
      animation: yisi-pop 120ms ease-out;
    }

    @media (prefers-reduced-motion: reduce) {
      .permission-popover { animation: none; }
    }

    .permission-title {
      height: 20px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: .4px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }

    .permission-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      max-height: min(430px, 80vh);
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .pm-row {
      min-height: 28px;
      padding: 2px 6px;
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr) 12px;
      column-gap: 4px;
      align-items: center;
      width: 100%;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      text-align: left;
    }

    .pm-row:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .pm-row[aria-checked="true"] {
      background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground));
    }

    .pm-row:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .pm-row[aria-checked="true"]:hover {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    body.vscode-high-contrast .pm-row[aria-checked="true"],
    body.vscode-high-contrast-light .pm-row[aria-checked="true"] {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .pm-icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pm-icon {
      display: block;
      width: 14px;
      height: 14px;
      color: var(--vscode-foreground);
      opacity: .9;
    }

    .pm-texts {
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .pm-title {
      font-size: 11px;
      font-weight: 500;
      line-height: 12px;
      color: var(--vscode-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pm-desc {
      font-size: 10px;
      line-height: 12px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pm-check {
      color: var(--vscode-foreground);
      font-size: 11px;
      font-weight: 500;
      text-align: right;
    }

    .pm-row[data-mode="fullAccess"] .pm-title {
      color: var(--vscode-editorWarning-foreground, var(--vscode-errorForeground));
    }

    .pm-divider {
      height: 1px;
      margin: 1px 6px;
      background: var(--vscode-widget-border);
      opacity: .5;
    }
  `;
}

export function permissionButtonMarkup(): string {
  return `
    <button class="mode-pill" id="permissionButton" type="button" title="Permission mode"
            aria-haspopup="menu" aria-expanded="false">
      <span class="pill-name" id="permissionPillName">Plan</span>
      <span class="pill-chevron">⌄</span>
    </button>
  `;
}

export function permissionPopoverMarkup(): string {
  return `
    <div class="permission-popover" id="permissionPopover" role="menu" aria-label="Permission modes" hidden>
      <div class="permission-title">Modes</div>
      <div class="permission-list" id="permissionModeList" role="group"></div>
    </div>
  `;
}

export function permissionClientScript(): string {
  return `
function createYisiPermissionControl(vscode) {
  var popover = document.getElementById('permissionPopover');
  var button = document.getElementById('permissionButton');
  var pillName = document.getElementById('permissionPillName');
  var list = document.getElementById('permissionModeList');
  var currentMode = 'plan';
  var isOpen = false;
  var rows = [];

  var MODES = [
    { value: 'manual', title: 'Manual', desc: 'Ask before every workspace edit' },
    { value: 'acceptEdits', title: 'Edit automatically', desc: 'Apply file edits automatically' },
    { value: 'plan', title: 'Plan', desc: 'Analyze and plan before editing' },
    { value: 'auto', title: 'Auto', desc: 'Run safe actions automatically; ask for risky ones' }
  ];
  var FULL = {
    value: 'fullAccess',
    title: 'Full Access',
    desc: 'Broad autonomy with critical safety checks'
  };

  var LABELS = {
    manual: 'Manual',
    acceptEdits: 'Edit automatically',
    plan: 'Plan',
    auto: 'Auto',
    fullAccess: 'Full Access'
  };

  function icon(value) {
    var body = '';
    var common = ' class="pm-icon" width="14" height="14" viewBox="0 0 16 16"' +
      ' fill="none" stroke="currentColor" stroke-width="1.5"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (value === 'manual') {
      body = '<circle cx="8" cy="8" r="5.8"></circle>' +
        '<path d="M8 5.3v2.8"></path>' +
        '<circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none"></circle>';
    } else if (value === 'acceptEdits') {
      body = '<path d="M4.6 3.5L1.4 8l3.2 4.5"></path>' +
        '<path d="M11.4 3.5L14.6 8l-3.2 4.5"></path>' +
        '<path d="M9.3 2.8L6.7 13.2"></path>';
    } else if (value === 'plan') {
      body = '<path d="M3.2 1.7h6.1l3.5 3.5v9.1H3.2z"></path>' +
        '<path d="M9.3 1.7v3.5h3.5"></path>' +
        '<path d="M5.7 8.6h4.7M5.7 11h4.7"></path>';
    } else if (value === 'auto') {
      body = '<path d="M9 1.3L4.1 9h3.6l-.9 5.7 5.1-7.5H8.4z"></path>';
    } else if (value === 'fullAccess') {
      body = '<path d="M8 1.6l4.9 1.7v3.3c0 3.1-2 5.6-4.9 6.7-2.9-1.1-4.9-3.6-4.9-6.7V3.3z"></path>';
    }
    return '<svg' + common + '>' + body + '</svg>';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function label(mode) {
    return LABELS[mode] || 'Plan';
  }

  function setMode(mode) {
    currentMode = mode === 'manual' || mode === 'acceptEdits' || mode === 'plan' ||
      mode === 'auto' || mode === 'fullAccess' ? mode : 'plan';
    pillName.textContent = label(currentMode);
    pillName.title = label(currentMode);
    if (isOpen) render();
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render();
    positionPopover();
    focusCurrent();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function render() {
    list.replaceChildren();
    rows = [];
    function addRow(spec) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'pm-row';
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', spec.value === currentMode ? 'true' : 'false');
      row.setAttribute('data-mode', spec.value);

      var iconBox = el('span', 'pm-icon-wrap');
      iconBox.innerHTML = icon(spec.value);

      var texts = el('span', 'pm-texts');
      texts.appendChild(el('span', 'pm-title', spec.title));
      texts.appendChild(el('span', 'pm-desc', spec.desc));

      var check = el('span', 'pm-check', spec.value === currentMode ? '\\u2713' : '');

      row.appendChild(iconBox);
      row.appendChild(texts);
      row.appendChild(check);
      row.addEventListener('click', function () { choose(spec.value); });
      list.appendChild(row);
      rows.push(row);
    }
    MODES.forEach(addRow);
    list.appendChild(el('div', 'pm-divider', ''));
    addRow(FULL);
  }

  function choose(mode) {
    vscode.postMessage({ type: 'permission.setMode', value: mode });
    close();
  }

  function focusableRows() {
    return rows.filter(function (row) { return !row.hidden; });
  }

  function focusCurrent() {
    var focusable = focusableRows();
    if (focusable.length === 0) return;
    var index = -1;
    for (var i = 0; i < focusable.length; i += 1) {
      if (focusable[i].getAttribute('data-mode') === currentMode) { index = i; break; }
    }
    focusable[Math.max(0, index)].focus();
  }

  function positionPopover() {
    var rect = button.getBoundingClientRect();
    popover.style.left = '0px';
    popover.style.top = '0px';
    popover.style.visibility = 'hidden';
    var width = popover.offsetWidth;
    var height = popover.offsetHeight;
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var left = Math.min(Math.max(8, rect.left + rect.width - width), viewportWidth - width - 8);
    var top = rect.top - height - 6;
    if (top < 8) top = Math.min(rect.bottom + 6, viewportHeight - height - 8);
    popover.style.left = left + 'px';
    popover.style.top = Math.max(8, top) + 'px';
    popover.style.visibility = '';
  }

  function moveFocus(direction) {
    var focusable = focusableRows();
    if (focusable.length === 0) return;
    var index = focusable.indexOf(document.activeElement);
    if (index === -1) index = 0;
    index = (index + direction + focusable.length) % focusable.length;
    focusable[index].focus();
  }

  function handleKeydown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      button.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === 'Tab') {
      var focusable = focusableRows();
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('click', function (event) {
    if (!isOpen) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    close();
  });
  document.addEventListener('keydown', handleKeydown);
  button.addEventListener('click', toggle);

  return {
    setMode: setMode,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return isOpen; }
  };
}
`;
}
