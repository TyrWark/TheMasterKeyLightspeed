(function () {
  'use strict';

  function isReportsPage() {
    try {
      const params = new URLSearchParams(location.search);
      return params.get('form_name') === 'ui_tab' && params.get('tab') === 'reports';
    } catch (err) {
      return false;
    }
  }

  function getAccountId() {
    const masterKeyAccountId = window.__mkl && typeof window.__mkl.getAccountId === 'function'
      ? window.__mkl.getAccountId()
      : null;
    if (masterKeyAccountId) return String(masterKeyAccountId);

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const merchantos = pageWindow.merchantos || window.merchantos;
    return merchantos && merchantos.account && merchantos.account.id
      ? String(merchantos.account.id)
      : null;
  }

  function showToast(message) {
    const existing = document.getElementById('slm-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'slm-toast';
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:20px', 'z-index:2147483647',
      'background:#111827', 'color:#fff', 'padding:10px 14px', 'border-radius:8px',
      'font:12px/1.4 sans-serif', 'box-shadow:0 8px 24px rgba(0,0,0,.25)', 'max-width:320px',
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  function ensurePanel() {
    if (document.getElementById('slm-panel-root')) return;

    const root = document.createElement('div');
    root.id = 'slm-panel-root';
    root.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.46);display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:sans-serif;';
    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(900px, calc(100vw - 32px));max-height:88vh;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.4);padding:16px;color:#111;';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px;">SaleLine Editor</h3>
        <button id="slm-close" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;">Close</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="slm-saleLineId" type="number" min="1" placeholder="SaleLine ID" style="flex:1 1 160px;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" />
        <button id="slm-load" style="padding:10px 14px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;">Load</button>
        <button id="slm-save" style="padding:10px 14px;border:0;border-radius:6px;background:#047857;color:#fff;cursor:pointer;display:none;">Save PUT</button>
        <button id="slm-delete" style="padding:10px 14px;border:0;border-radius:6px;background:#b91c1c;color:#fff;cursor:pointer;display:none;">Delete</button>
      </div>
      <div id="slm-status" style="font-size:12px;color:#475569;margin-bottom:10px;min-height:18px;">Enter a SaleLine ID and click Load.</div>
      <textarea id="slm-editor" spellcheck="false" style="width:100%;min-height:420px;padding:12px;border:1px solid #d1d5db;border-radius:8px;font:12px/1.5 'SFMono-Regular',Consolas,monospace;resize:vertical;box-sizing:border-box;display:none;"></textarea>`;
    root.appendChild(panel);
    document.body.appendChild(root);

    const close = document.getElementById('slm-close');
    const loadBtn = document.getElementById('slm-load');
    const saveBtn = document.getElementById('slm-save');
    const deleteBtn = document.getElementById('slm-delete');
    const idInput = document.getElementById('slm-saleLineId');
    const editor = document.getElementById('slm-editor');
    const status = document.getElementById('slm-status');
    let currentSaleLineId = null;

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.style.color = isError ? '#b91c1c' : '#475569';
    };
    const showEditor = () => { editor.style.display = 'block'; saveBtn.style.display = 'inline-block'; deleteBtn.style.display = 'inline-block'; };
    const hideEditor = () => { editor.style.display = 'none'; saveBtn.style.display = 'none'; deleteBtn.style.display = 'none'; };
    const apiUrl = (saleLineId, relations = false) => {
      const accountId = getAccountId();
      return accountId ? `/API/V3/Account/${encodeURIComponent(accountId)}/SaleLine/${encodeURIComponent(saleLineId)}.json${relations ? '?load_relations=all' : ''}` : null;
    };

    async function loadSaleLine() {
      const saleLineId = String(idInput.value).trim();
      const url = apiUrl(saleLineId, true);
      if (!url) return setStatus('Could not read the Lightspeed account ID.', true);
      if (!saleLineId) return setStatus('Please enter a SaleLine ID.', true);
      setStatus('Loading SaleLine...');
      try {
        const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()) || res.statusText}`);
        const json = await res.json();
        const payload = json && json.SaleLine ? json.SaleLine : json;
        if (!payload || typeof payload !== 'object') throw new Error('Loaded response did not include a SaleLine object.');
        currentSaleLineId = String(payload.saleLineID || saleLineId);
        editor.value = JSON.stringify(payload, null, 2);
        showEditor();
        setStatus(`Loaded SaleLine ${currentSaleLineId}.`);
      } catch (error) {
        currentSaleLineId = null;
        hideEditor();
        setStatus(error.message || 'Failed to load SaleLine.', true);
      }
    }

    async function saveSaleLine() {
      if (!currentSaleLineId) return setStatus('Load a SaleLine before saving.', true);
      const url = apiUrl(currentSaleLineId);
      if (!url) return setStatus('Could not read the Lightspeed account ID.', true);
      let parsed;
      try { parsed = JSON.parse(editor.value); } catch (error) { return setStatus('Invalid JSON. Fix the edit before saving.', true); }
      setStatus('Saving SaleLine...');
      try {
        const res = await fetch(url, { method: 'PUT', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
        showToast('SaleLine saved.');
        setStatus(`Saved SaleLine ${currentSaleLineId}.`);
      } catch (error) { setStatus(error.message || 'Save failed.', true); }
    }

    async function deleteSaleLine() {
      if (!currentSaleLineId) return setStatus('Load a SaleLine before deleting.', true);
      const url = apiUrl(currentSaleLineId);
      if (!url) return setStatus('Could not read the Lightspeed account ID.', true);
      if (!window.confirm(`Delete SaleLine ${currentSaleLineId}? This cannot be undone.`)) return;
      setStatus('Deleting SaleLine...');
      try {
        const res = await fetch(url, { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
        showToast(`SaleLine ${currentSaleLineId} deleted.`);
        currentSaleLineId = null;
        idInput.value = '';
        editor.value = '';
        hideEditor();
        setStatus('SaleLine deleted successfully.');
      } catch (error) { setStatus(error.message || 'Delete failed.', true); }
    }

    close.addEventListener('click', () => root.remove());
    root.addEventListener('click', (event) => { if (event.target === root) root.remove(); });
    loadBtn.addEventListener('click', loadSaleLine);
    saveBtn.addEventListener('click', saveSaleLine);
    deleteBtn.addEventListener('click', deleteSaleLine);
    idInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadSaleLine(); });
  }

  function openPanel() {
    ensurePanel();
    const input = document.getElementById('slm-saleLineId');
    if (input) { input.focus(); input.select(); }
  }

  function ensureTrigger() {
    if (document.getElementById('slm-trigger')) return;
    const reportHeader = document.querySelector('#reports_lstoolbox_section > h2');
    if (!reportHeader) return;

    const trigger = document.createElement('span');
    trigger.id = 'slm-trigger';
    trigger.textContent = 'SaleLine Manager';
    trigger.title = 'Load, edit, and delete a specific SaleLine';
    trigger.className = 'lstoolbox-title-link';
    trigger.setAttribute('aria-label', 'SaleLine Manager');
    trigger.setAttribute('role', 'button');
    trigger.tabIndex = 0;
    trigger.addEventListener('click', openPanel);
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPanel(); }
    });
    reportHeader.style.display = 'flex';
    reportHeader.style.alignItems = 'center';
    reportHeader.style.gap = '8px';
    reportHeader.style.flexWrap = 'wrap';
    reportHeader.appendChild(trigger);
  }

  function removeTrigger() {
    const trigger = document.getElementById('slm-trigger');
    if (trigger) trigger.remove();
  }

  function bootstrap() {
    if (isReportsPage()) ensureTrigger();
    else removeTrigger();
  }

  new MutationObserver(() => { if (isReportsPage()) ensureTrigger(); })
    .observe(document.documentElement || document.body, { childList: true, subtree: true });
  if (window.__mkl && typeof window.__mkl.onRouteChange === 'function') window.__mkl.onRouteChange(bootstrap);
  bootstrap();

  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('SaleLine Manager', openPanel);
})();