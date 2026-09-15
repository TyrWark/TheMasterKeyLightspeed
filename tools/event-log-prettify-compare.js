(function () {
  'use strict';

  const BTN_PRETTY = 'ls-pretty-json-btn';
  const BTN_COMPARE = 'ls-compare-btn';
  const API_CONCURRENCY = 4;

  // ---------- page gating ----------
  function onEventLogPage() {
    const q = new URLSearchParams(location.search);
    return q.get('name') === 'transaction.views.transaction' && q.get('tab') === 'event_log';
  }

  function accountID() {
    return window.merchantos && window.merchantos.account && window.merchantos.account.id;
  }

  // ---------- entity decode + prettify ----------
  const decoder = document.createElement('textarea');
  function decodeEntities(s) { decoder.innerHTML = s; return decoder.value; }

  function prettifyPre(pre) {
    let changed = false;
    pre.childNodes.forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const m = node.nodeValue.match(/^(\s*values\s*\[)([\s\S]*)\](\s*)$/);
      if (!m) return;
      try {
        node.nodeValue = 'values [\n' + JSON.stringify(JSON.parse(decodeEntities(m[2]).trim()), null, 2) + '\n]';
        changed = true;
      } catch (e) { /* leave */ }
    });
    return changed;
  }

  function expandStripPrettify() {
    document.querySelectorAll('[id$="_form_vars_long"]').forEach((el) => (el.style.display = ''));
    document.querySelectorAll('[id$="_form_vars_short"]').forEach((el) => (el.style.display = 'none'));
    document.querySelectorAll('[id$="_form_vars_long"] > a').forEach((a) => (a.style.display = 'none'));
    let n = 0;
    document.querySelectorAll('[id*="_form_vars_long"] pre').forEach((pre) => { if (prettifyPre(pre)) n++; });
    return n;
  }

  // ---------- API layer (same-origin session cookie) ----------
  function limiter(max) {
    let active = 0; const q = [];
    const next = () => {
      if (active >= max || !q.length) return;
      active++; const { fn, res, rej } = q.shift();
      fn().then(res, rej).finally(() => { active--; next(); });
    };
    return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
  }
  const gate = limiter(API_CONCURRENCY);

  async function apiGet(path) {
    const acct = accountID();
    if (!acct) throw new Error('accountID unavailable (window.merchantos.account.id)');
    const res = await fetch(`/API/V3/Account/${acct}/${path}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
    return res.json();
  }

  // caches keyed by id so repeated line_ids don't re-fetch
  const saleLineCache = new Map();
  const itemCache = new Map();
  const itemShopCache = new Map();

  const getSaleLine = (id) =>
    saleLineCache.get(id) ||
    saleLineCache.set(id, gate(() => apiGet(`SaleLine/${id}.json`).then((d) => d.SaleLine))).get(id);

  const getItem = (id) =>
    itemCache.get(id) ||
    itemCache.set(id, gate(() => apiGet(`Item/${id}.json`).then((d) => d.Item))).get(id);

  const getItemShops = (itemID) =>
    itemShopCache.get(itemID) ||
    itemShopCache
      .set(itemID, gate(() => apiGet(`ItemShop.json?itemID=${itemID}`).then((d) => {
        const s = d.ItemShop;
        return Array.isArray(s) ? s : s ? [s] : [];
      })))
      .get(itemID);

  // ---------- value helpers ----------
  const asArr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

  function itemDefaultPrice(item) {
    const arr = asArr(item && item.Prices && item.Prices.ItemPrice);
    const d = arr.find((p) => p.useType === 'Default') || arr.find((p) => String(p.useTypeID) === '1');
    return d ? d.amount : null;
  }

  function shopAvgCost(shops, shopID) {
    const bad = (v) => v == null || v === '' || parseFloat(v) === 0;
    let rec = shops.find((s) => String(s.shopID) === String(shopID));
    let note = `shop ${shopID}`;
    if (!rec || bad(rec.averageCost)) {
      const acctWide = shops.find((s) => String(s.shopID) === '0');
      if (acctWide) { rec = acctWide; note = 'account-wide'; }
    }
    return rec ? { cost: rec.averageCost, note } : null;
  }

  const normBool = (v) => v === true || v === 1 || v === '1' || v === 'true' || String(v).toLowerCase() === 'on';
  const eqInt = (a, b) => parseInt(a, 10) === parseInt(b, 10);
  const eqMoney = (a, b) => a != null && b != null && Math.abs(parseFloat(a) - parseFloat(b)) < 0.005;
  const money = (v) => (v == null || v === '' ? '\u2014' : Number(v).toFixed(2));

  // ---------- what THIS event-log row actually captured ----------
  function rowCaptured(pre) {
    const out = {};
    const txt = pre.textContent;

    // inline_edit.save_transaction_line -> values [ {...} ]
    const vm = txt.match(/values\s*\[\s*(\{[\s\S]*?\})\s*\]/);
    if (vm) {
      try {
        const v = JSON.parse(decodeEntities(vm[1]));
        if ('edit_item_class' in v) out.taxClassID = v.edit_item_class;
        if ('edit_item_price' in v) out.price = v.edit_item_price;
        if ('edit_item_tax' in v) out.tax = normBool(v.edit_item_tax);
      } catch (e) { /* ignore */ }
    }

    // direct_edit.save_transaction_line -> field [transaction_line.X]  new_value [Y]
    const fm = txt.match(/field\s*\[([^\]]+)\]/);
    const nv = txt.match(/new_value\s*\[([^\]]*)\]/);
    if (fm && nv) {
      const f = fm[1].toLowerCase();
      const val = nv[1];
      if (f.includes('tax_class')) out.taxClassID = val;
      else if (f.includes('unit_price') || f.endsWith('.price')) out.price = val;
      else if (f.endsWith('.tax')) out.tax = normBool(val);
    }
    return out;
  }

  // ---------- comparison table ----------
  function buildComparison(sl, item, shopCost, ov) {
    ov = ov || {};
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:6px 0 2px;font:12px/1.4 monospace;';

    const itemID = sl.itemID && String(sl.itemID) !== '0' ? sl.itemID : null;
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:bold;margin-bottom:3px;';
    if (itemID) {
      head.appendChild(document.createTextNode(`SaleLine #${sl.saleLineID} → `));
      const a = document.createElement('a');
      a.href = `${location.origin}/?name=item.views.item&form_name=view&id=${itemID}&tab=details`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.cssText = 'color:#0a7cff;text-decoration:underline;';
      a.textContent = `Item #${itemID}: ${item ? item.description : '(item load failed)'}`;
      head.appendChild(a);
    } else {
      head.textContent = `SaleLine #${sl.saleLineID} — miscellaneous line (no item)`;
    }
    wrap.appendChild(head);

    if (!item) { return wrap; }

    const defPrice = itemDefaultPrice(item);
    // event-log row value takes precedence over the live SaleLine
    const src = (evVal, slVal) =>
      evVal !== undefined && evVal !== null && evVal !== ''
        ? { val: evVal, ev: true }
        : { val: slVal, ev: false };

    const taxClass = src(ov.taxClassID, sl.taxClassID);
    const taxable = ov.tax !== undefined ? { val: ov.tax, ev: true } : { val: sl.tax, ev: false };
    const price = src(ov.price, sl.unitPrice);
    const cost = { val: sl.avgCost, ev: false };

    const rows = [
      { label: 'Tax Class ID', s: taxClass, def: item.taxClassID, eq: eqInt, fmt: (v) => v },
      { label: 'Taxable',      s: taxable,  def: item.tax,        eq: (a, b) => normBool(a) === normBool(b), fmt: (v) => (normBool(v) ? 'Yes' : 'No') },
      { label: 'Price',        s: price,    def: defPrice,        eq: eqMoney, fmt: money },
      { label: 'Cost',         s: cost,     def: shopCost && shopCost.cost, eq: eqMoney, fmt: money,
        defSuffix: shopCost ? ` (${shopCost.note})` : '' },
    ];

    let anyEvent = false;
    const t = document.createElement('table');
    t.style.cssText = 'border-collapse:collapse;';
    t.innerHTML =
      '<tr style="text-align:left"><th style="padding:1px 10px 1px 0">Field</th>' +
      '<th style="padding:1px 10px 1px 0">SaleLine</th>' +
      '<th style="padding:1px 10px 1px 0">Item default</th><th></th></tr>';

    rows.forEach((r) => {
      const line = r.s.val;
      const has = r.def != null && line != null && line !== '';
      const hot = has && !r.eq(line, r.def);
      if (r.s.ev) anyEvent = true;
      const marker = r.s.ev ? ' <span title="captured by this event log entry" style="color:#0a8f3c">†</span>' : '';
      const lineStyle = hot ? 'padding:1px 10px 1px 0;color:#b00020;font-weight:bold;' : 'padding:1px 10px 1px 0;';
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td style="padding:1px 10px 1px 0">${r.label}</td>` +
        `<td style="${lineStyle}">${r.fmt(line)}${marker}</td>` +
        `<td style="padding:1px 10px 1px 0">${r.fmt(r.def)}${r.defSuffix || ''}</td>` +
        `<td style="color:#b00020;font-weight:bold">${hot ? '\u2190 changed' : ''}</td>`;
      t.appendChild(tr);
    });
    wrap.appendChild(t);

    const ref = document.createElement('div');
    ref.style.cssText = 'color:#777;margin-top:2px;';
    ref.textContent =
      `ref: live SaleLine unitPrice=${money(sl.unitPrice)}, taxClassID=${sl.taxClassID}, ` +
      `normalUnitPrice=${money(sl.normalUnitPrice)}, fifoCost=${money(sl.fifoCost)}` +
      `  |  item defaultCost=${money(item.defaultCost)}, taxClass "${(item.TaxClass && item.TaxClass.name) || ''}"`;
    wrap.appendChild(ref);

    if (anyEvent) {
      const legend = document.createElement('div');
      legend.style.cssText = 'color:#0a8f3c;margin-top:1px;';
      legend.textContent = `† value captured by this event log entry — takes precedence over the current SaleLine #${sl.saleLineID}`;
      wrap.appendChild(legend);
    }
    return wrap;
  }

  function lineIdFromPre(pre) {
    const txt = pre.textContent;
    const m = txt.match(/line_id\s*\[(\d+)\]/) || txt.match(/(?:^|\s)id\s*\[(\d+)\]/);
    return m ? m[1] : null;
  }

  async function processRow(pre) {
    if (pre.dataset.lsCompareDone) return;
    const lineId = lineIdFromPre(pre);
    if (!lineId) return;
    pre.dataset.lsCompareDone = '1';

    const ov = rowCaptured(pre);

    const status = document.createElement('div');
    status.style.cssText = 'font:12px monospace;color:#777;margin-top:4px;';
    status.textContent = `Loading SaleLine #${lineId}…`;
    pre.after(status);

    try {
      const sl = await getSaleLine(lineId);
      let item = null, shopCost = null;
      if (sl.itemID && String(sl.itemID) !== '0') {
        const [it, shops] = await Promise.all([
          getItem(sl.itemID).catch(() => null),
          getItemShops(sl.itemID).catch(() => []),
        ]);
        item = it;
        shopCost = shopAvgCost(shops || [], sl.shopID);
      }
      status.replaceWith(buildComparison(sl, item, shopCost, ov));
    } catch (e) {
      status.style.color = '#b00020';
      status.textContent = `SaleLine #${lineId}: ${e.message}`;
    }
  }

  async function runCompare(btn) {
    if (!accountID()) { alert('Could not read window.merchantos.account.id — are you logged into the SPA?'); return; }
    expandStripPrettify();
    const pres = [...document.querySelectorAll('[id*="_form_vars_long"] pre')].filter((p) => lineIdFromPre(p));
    btn.textContent = `Fetching ${pres.length} line(s)…`;
    await Promise.all(pres.map(processRow));
    btn.textContent = 'Compare SaleLine ↔ Item defaults ✓';
    setTimeout(() => (btn.textContent = 'Compare SaleLine ↔ Item defaults'), 3000);
  }

  // ---------- button injection ----------
  function mkBtn(id, label, bg, onClick) {
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.textContent = label;
    b.style.cssText =
      `margin:8px 8px 8px 0;padding:6px 12px;font:inherit;cursor:pointer;background:${bg};color:#fff;border:none;border-radius:4px;`;
    b.addEventListener('click', () => onClick(b));
    return b;
  }

  function injectButtons() {
    if (document.getElementById(BTN_PRETTY)) return;
    const table =
      document.querySelector('#admin_listings_events_view table') ||
      document.querySelector('#tab_event_log > div > table') ||
      document.querySelector('#tab_event_log table');
    if (!table) return;

    const bar = document.createElement('div');
    bar.appendChild(mkBtn(BTN_PRETTY, 'Expand + Prettify "values" JSON', '#0a7cff', (b) => {
      const n = expandStripPrettify();
      b.textContent = `Prettified ${n} row(s) ✓`;
      setTimeout(() => (b.textContent = 'Expand + Prettify "values" JSON'), 2500);
    }));
    bar.appendChild(mkBtn(BTN_COMPARE, 'Compare SaleLine ↔ Item defaults', '#0a8f3c', runCompare));
    table.parentNode.insertBefore(bar, table);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; if (onEventLogPage()) injectButtons(); }, 300);
  }).observe(document.body, { childList: true, subtree: true });

  if (onEventLogPage()) injectButtons();
})();
