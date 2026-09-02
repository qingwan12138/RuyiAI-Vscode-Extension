// Compact Codex-style model controller: styles, markup, and a client-side
// factory function. chatViewHtml.ts composes these into the chat view. The
// client code is injected as a plain global function so the main chat script
// can wire it to the shared `vscode` messaging API without duplicating
// protocol logic.
//
// Page model: at any moment exactly one of `root` | `models` | `speed` is
// visible inside the popover. Reasoning is rendered directly in the root menu;
// there is no reasoning sub-page and no advanced-parameters section.

export function modelControlStyles(): string {
  return `
    /* ---- Composer model pill ---- */
    .model-pill {
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

    .model-pill:hover {
      background: var(--yisi-surface-hover);
    }

    .model-pill[aria-expanded="true"] {
      background: var(--yisi-surface-hover);
    }

    .model-pill:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .model-pill .pill-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .model-pill .pill-warning {
      flex: 0 0 auto;
      color: var(--vscode-errorForeground, var(--vscode-descriptionForeground));
      font-size: 11px;
      font-weight: 600;
    }

    .model-pill .pill-chevron {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      opacity: .85;
    }

    /* ---- Popover ---- */
    .model-popover {
      position: fixed;
      z-index: 60;
      width: 220px;
      max-width: calc(100vw - 16px);
      padding: 4px;
      background: var(--vscode-editorWidget-background, var(--vscode-menu-background));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .18);
      animation: yisi-pop 120ms ease-out;
    }

    @keyframes yisi-pop {
      from { opacity: 0; transform: translateY(4px) scale(.98); }
      to { opacity: 1; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .model-popover { animation: none; }
    }

    .model-popover-view {
      display: flex;
      flex-direction: column;
    }

    .mcv-page {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .mcv-page[hidden] {
      display: none;
    }

    /* ---- Root menu ---- */
    .mcv-section-title {
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

    .mcv-reasoning-option,
    .mcv-row,
    .mcv-option,
    .mcv-back {
      min-height: 28px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 11px;
      font-weight: 400;
      width: 100%;
      text-align: left;
    }

    .mcv-reasoning-option:hover,
    .mcv-row:hover,
    .mcv-option:hover,
    .mcv-back:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .mcv-reasoning-option:focus-visible,
    .mcv-row:focus-visible,
    .mcv-option:focus-visible,
    .mcv-back:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .mcv-reasoning-option[aria-checked="true"],
    .mcv-option[aria-checked="true"] {
      background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground));
    }

    .mcv-reasoning-option[aria-checked="true"]:hover,
    .mcv-option[aria-checked="true"]:hover {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    body.vscode-high-contrast .mcv-reasoning-option[aria-checked="true"],
    body.vscode-high-contrast-light .mcv-reasoning-option[aria-checked="true"],
    body.vscode-high-contrast .mcv-option[aria-checked="true"],
    body.vscode-high-contrast-light .mcv-option[aria-checked="true"] {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .mcv-reasoning-option .check {
      margin-left: auto;
      flex: 0 0 auto;
      color: var(--vscode-foreground);
      font-size: 11px;
    }

    .mcv-divider {
      height: 1px;
      margin: 1px 6px;
      background: var(--vscode-widget-border);
      opacity: .5;
    }

    .mcv-row .mcv-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mcv-row .mcv-arrow {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      opacity: .85;
    }

    .mcv-row.is-muted {
      color: var(--vscode-descriptionForeground);
    }

    /* ---- Sub pages (models / speed) ---- */
    .mcv-back .back-arrow {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      line-height: 1;
    }

    .mcv-back .back-title {
      font-weight: 400;
    }

    .mcv-scroll {
      max-height: min(260px, 60vh);
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .mcv-group-title {
      height: 20px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }

    .mcv-group-title:not(:first-child) {
      margin-top: 2px;
    }

    .mcv-badge {
      padding: 0 4px;
      border-radius: 999px;
      background: var(--yisi-surface);
      color: var(--yisi-muted);
      font-size: 8px;
    }

    .mcv-option .name {
      flex: 1 1 auto;
      order: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mcv-option .check {
      flex: 0 0 auto;
      order: 2;
      color: var(--vscode-foreground);
      font-size: 11px;
    }

    .mcv-options {
      padding: 1px;
    }

    .mcv-empty {
      padding: 10px 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-align: center;
    }

    .mcv-manage {
      min-height: 28px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
  `;
}

export function modelControlButtonMarkup(): string {
  return `
    <button class="model-pill" id="modelButton" type="button" title="Choose model" aria-haspopup="menu" aria-expanded="false">
      <span class="pill-name" id="modelPillName">选择模型</span>
      <span class="pill-warning" id="modelPillWarning" hidden>!</span>
      <span class="pill-chevron">⌄</span>
    </button>
  `;
}

export function modelControlPopoverMarkup(): string {
  return `
    <div class="model-popover" id="modelPopover" role="menu" aria-label="Model controls" hidden>
      <div class="model-popover-view" id="modelPopoverView">
        <div class="mcv-page" id="mcvRoot"></div>
        <div class="mcv-page" id="mcvModels" hidden>
          <button class="mcv-back" type="button" data-action="back">
            <span class="back-arrow">‹</span>
            <span class="back-title">模型</span>
          </button>
          <div class="mcv-scroll" id="mcvModelsList"></div>
          <div class="mcv-divider"></div>
          <button class="mcv-row mcv-manage" type="button" data-action="manageSettings">
            <span class="mcv-label">管理模型配置...</span>
          </button>
        </div>
        <div class="mcv-page" id="mcvSpeed" hidden>
          <button class="mcv-back" type="button" data-action="back">
            <span class="back-arrow">‹</span>
            <span class="back-title">速度</span>
          </button>
          <div class="mcv-options" id="mcvSpeedOptions"></div>
        </div>
      </div>
    </div>
  `;
}

export function modelControlClientScript(): string {
  return `
function createYisiModelControl(vscode) {
  var root = document.getElementById('modelPopover');
  var button = document.getElementById('modelButton');
  var nameEl = document.getElementById('modelPillName');
  var warningEl = document.getElementById('modelPillWarning');
  var rootPage = document.getElementById('mcvRoot');
  var modelsPage = document.getElementById('mcvModels');
  var modelsList = document.getElementById('mcvModelsList');
  var speedPage = document.getElementById('mcvSpeed');
  var speedOptions = document.getElementById('mcvSpeedOptions');
  var state = null;
  var isOpen = false;
  var activePage = 'root';

  function caps() {
    return state && state.current ? state.current.capabilities : null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function reasoningLabel(effort) {
    var labels = {
      auto: '自动',
      off: '关闭',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '极高'
    };
    return labels[effort] || effort;
  }

  function speedLabel(mode) {
    return mode === 'fast' ? '快速' : '标准';
  }

  function updateState(next) {
    state = next || state;
    renderButton();
    if (isOpen) renderActivePage();
  }

  function renderButton() {
    if (!state || !state.current) return;
    var current = state.current;
    var selected = current.providerId && current.modelId;
    if (!selected) {
      nameEl.textContent = '选择模型';
      nameEl.title = '选择模型';
      warningEl.hidden = true;
    } else if (!current.available) {
      nameEl.textContent = current.displayName;
      nameEl.title = '模型不可用';
      warningEl.hidden = false;
    } else {
      nameEl.textContent = current.displayName;
      nameEl.title = current.displayName;
      warningEl.hidden = true;
    }
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    root.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    var current = state && state.current;
    var selected = current && current.providerId && current.modelId;
    showPage(selected ? 'root' : 'models');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    activePage = 'root';
    rootPage.hidden = false;
    modelsPage.hidden = true;
    speedPage.hidden = true;
  }

  function renderActivePage() {
    if (activePage === 'models') renderModels();
    else if (activePage === 'speed') renderSpeed();
    else renderRoot();
  }

  function showPage(page) {
    activePage = page;
    rootPage.hidden = page !== 'root';
    modelsPage.hidden = page !== 'models';
    speedPage.hidden = page !== 'speed';
    renderActivePage();
    positionPopover();
    focusPage();
  }

  function activePageElement() {
    if (activePage === 'models') return modelsPage;
    if (activePage === 'speed') return speedPage;
    return rootPage;
  }

  function focusPage() {
    var pageElement = activePageElement();
    if (!pageElement) return;
    var focusable = pageElement.querySelectorAll('button');
    if (focusable.length > 0) focusable[0].focus();
  }

  function renderRoot() {
    rootPage.replaceChildren();
    if (!state || !state.current) return;
    var current = state.current;
    var capability = caps();
    var selected = current.providerId && current.modelId;
    var available = selected && current.available;

    var presets = (capability && capability.reasoningPresets) || [];
    if (available && presets.length > 0) {
      rootPage.appendChild(el('div', 'mcv-section-title', '推理'));
      var activeEffort = current.reasoningEffort
        || (capability && capability.reasoningDefault) || 'auto';
      presets.forEach(function (preset) {
        var option = document.createElement('button');
        option.type = 'button';
        option.className = 'mcv-reasoning-option';
        option.setAttribute('aria-checked', activeEffort === preset ? 'true' : 'false');
        option.appendChild(el('span', 'reasoning-label', reasoningLabel(preset)));
        option.appendChild(el('span', 'check', activeEffort === preset ? '✓' : ''));
        option.addEventListener('click', function () {
          vscode.postMessage({ type: 'modelControl.setReasoning', value: preset });
        });
        rootPage.appendChild(option);
      });
      rootPage.appendChild(el('div', 'mcv-divider'));
    }

    var modelRow = document.createElement('button');
    modelRow.type = 'button';
    modelRow.className = 'mcv-row' + (selected && !available ? ' is-muted' : '');
    var modelText = selected ? current.displayName : '选择模型';
    modelRow.appendChild(el('span', 'mcv-label', modelText));
    modelRow.appendChild(el('span', 'mcv-arrow', '›'));
    modelRow.addEventListener('click', function () { showPage('models'); });
    rootPage.appendChild(modelRow);

    if (available && capability && capability.speedMode) {
      var speedRow = document.createElement('button');
      speedRow.type = 'button';
      speedRow.className = 'mcv-row';
      speedRow.appendChild(el('span', 'mcv-label', '速度'));
      speedRow.appendChild(el('span', 'mcv-arrow', '›'));
      speedRow.addEventListener('click', function () { showPage('speed'); });
      rootPage.appendChild(speedRow);
    }
  }

  function renderModels() {
    modelsList.replaceChildren();
    if (!state || !state.providers || state.providers.length === 0) {
      modelsList.appendChild(el('div', 'mcv-empty', '尚未配置模型 Provider'));
      return;
    }
    var current = state.current;
    function isCurrent(providerId, modelId) {
      return current && current.available
        && current.providerId === providerId
        && current.modelId === modelId;
    }
    state.providers.forEach(function (provider) {
      var group = el('div', 'mcv-group');
      var title = el('div', 'mcv-group-title', provider.name);
      if (!provider.configured) {
        title.appendChild(el('span', 'mcv-badge', '未配置'));
      }
      group.appendChild(title);
      provider.models.forEach(function (model) {
        var selected = isCurrent(provider.id, model.id);
        var option = document.createElement('button');
        option.type = 'button';
        option.className = 'mcv-option';
        option.setAttribute('aria-checked', selected ? 'true' : 'false');
        option.appendChild(el('span', 'name', model.name));
        option.appendChild(el('span', 'check', selected ? '✓' : ''));
        option.addEventListener('click', function () {
          vscode.postMessage({ type: 'modelControl.selectModel', providerId: provider.id, modelId: model.id });
          close();
        });
        group.appendChild(option);
      });
      modelsList.appendChild(group);
    });
  }

  function renderSpeed() {
    speedOptions.replaceChildren();
    var current = state && state.current ? state.current.speedMode : null;
    [
      { value: 'standard', label: '标准' },
      { value: 'fast', label: '快速' }
    ].forEach(function (option) {
      var selected = current === option.value;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'mcv-option';
      row.setAttribute('aria-checked', selected ? 'true' : 'false');
      row.appendChild(el('span', 'name', option.label));
      row.appendChild(el('span', 'check', selected ? '✓' : ''));
      row.addEventListener('click', function () {
        vscode.postMessage({ type: 'modelControl.setSpeed', value: option.value });
        showPage('root');
      });
      speedOptions.appendChild(row);
    });
  }

  function positionPopover() {
    var rect = button.getBoundingClientRect();
    root.style.left = '0px';
    root.style.top = '0px';
    root.style.visibility = 'hidden';
    var width = root.offsetWidth;
    var height = root.offsetHeight;
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var left = Math.min(Math.max(8, rect.left + rect.width - width), viewportWidth - width - 8);
    var top = rect.top - height - 6;
    if (top < 8) top = Math.min(rect.bottom + 6, viewportHeight - height - 8);
    root.style.left = left + 'px';
    root.style.top = Math.max(8, top) + 'px';
    root.style.visibility = '';
  }

  function handleKeydown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      button.focus();
      return;
    }
    if (event.key === 'Tab') {
      var pageElement = activePageElement();
      if (!pageElement) return;
      var focusable = Array.prototype.slice.call(pageElement.querySelectorAll('button'));
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

  function handleAction(event) {
    var target = event.target;
    while (target && target !== root && !target.hasAttribute('data-action')) {
      target = target.parentNode;
    }
    if (!target || target === root) return;
    var action = target.getAttribute('data-action');
    if (action === 'back') showPage('root');
    else if (action === 'manageSettings') {
      vscode.postMessage({ type: 'openSettings' });
      close();
    }
  }

  root.addEventListener('click', handleAction);
  document.addEventListener('click', function (event) {
    if (!isOpen) return;
    if (root.contains(event.target) || button.contains(event.target)) return;
    close();
  });
  document.addEventListener('keydown', handleKeydown);
  button.addEventListener('click', function () {
    toggle();
  });

  return {
    updateState: updateState,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return isOpen; }
  };
}
`;
}
