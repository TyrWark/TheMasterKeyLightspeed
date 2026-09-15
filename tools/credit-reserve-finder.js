(function () {
  'use strict';

  const PAYMENT_TYPE_ID = 4;   // reserved account credit
  const PAGE_LIMIT = 100;

  // ---- helpers -------------------------------------------------------------

  const getAccountId = () =>
    (window.merchantos && window.merchantos.account && window.merchantos.account.id) || null;

  const getUrlCustomerId = () => {
    const m = location.search.match(/[?&]id=(\d+)/);
    return m ? m[1] : null;
  };

  function isCustomerCreditPage() {
    const params = new URLSearchParams(location.search);
    return params.get('name') === 'customer.views.customer'
      && params.get('form_name') === 'view'
      && params.has('id')
      && ['details', 'account'].includes(params.get('tab'));
  }

  // SalePayments / SalePayment can be object or array -> always return array
  const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

  const isArchived = (payment) =>
    String(payment.archived).toLowerCase() === 'true';

  const apiBase = (accountId) => `/API/Account/${accountId}`;

  async function fetchJson(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return res.json();
  }

  // Paginate the Sale collection for a customer, incomplete only, w/ payments inline
  async function fetchIncompleteSalesWithPayments(accountId, customerId) {
    const relations = encodeURIComponent('["SalePayments"]');
    const all = [];
    let offset = 0;

    while (true) {
      const url =
        `${apiBase(accountId)}/Sale.json` +
        `?customerID=${encodeURIComponent(customerId)}` +
        `&completed=false` +
        `&load_relations=${relations}` +
        `&limit=${PAGE_LIMIT}&offset=${offset}`;

      const data = await fetchJson(url);
      const attrs = data['@attributes'] || {};
      const sales = asArray(data.Sale);
      all.push(...sales);

      const count = parseInt(attrs.count || sales.length, 10);
      offset += PAGE_LIMIT;
      if (offset >= count || sales.length === 0) break;
    }
    return all;
  }

  // Keep sales that are incomplete AND have >=1 payment with paymentTypeID 4.
  // Split the matching payments into active and archived groups for display.
  function filterMatches(sales) {
    const results = [];

    for (const sale of sales) {
      if (String(sale.completed) === 'true') continue; // re-verify incomplete

      const payments = asArray(sale.SalePayments && sale.SalePayments.SalePayment);
      const matchingPayments = payments.filter(
        (p) => String(p.paymentTypeID) === String(PAYMENT_TYPE_ID)
      );

      if (matchingPayments.length) {
        results.push({
          sale,
          matchingPayments,
          activePayments: matchingPayments.filter((p) => !isArchived(p)),
          archivedPayments: matchingPayments.filter(isArchived),
          allPayments: payments,
        });
      }
    }

    return results;
  }

  // ---- UI ------------------------------------------------------------------

  function paymentRows(payments) {
    return payments.map((p) => `
      <tr>
        <td>${p.salePaymentID ?? ''}</td>
        <td>${p.paymentTypeID ?? ''}</td>
        <td style="text-align:right">${p.amount ?? ''}</td>
        <td>${p.createTime ?? ''}</td>
        <td>${p.archived ?? ''}</td>
      </tr>`).join('');
  }

  function paymentTable(payments) {
    if (!payments.length) {
      return `<div style="padding:8px;color:#888;font-size:12px">
        No active matching payments.
      </div>`;
    }

    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th style="text-align:left">SalePaymentID</th>
        <th style="text-align:left">paymentTypeID</th>
        <th style="text-align:right">amount</th>
        <th style="text-align:left">createTime</th>
        <th style="text-align:left">archived</th>
      </tr></thead>
      <tbody>${paymentRows(payments)}</tbody>
    </table>`;
  }

  function archivedPaymentSection(payments) {
    if (!payments.length) return '';

    return `<details style="margin-top:8px;border:1px solid #e1e4e8;border-radius:4px">
      <summary style="cursor:pointer;padding:7px 9px;background:#f6f8fa;color:#555">
        Archived payments (${payments.length})
      </summary>
      <div style="padding:0 8px 8px">
        ${paymentTable(payments)}
      </div>
    </details>`;
  }

  function showModal(customerId, results) {
    document.getElementById('rac-modal')?.remove();

    const activeTotal = results.reduce(
      (sum, r) => sum + r.activePayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
      0
    );

    const archivedTotal = results.reduce(
      (sum, r) => sum + r.archivedPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
      0
    );

    const totalCredit = activeTotal + archivedTotal;

    const overlay = document.createElement('div');
    overlay.id = 'rac-modal';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.5)',
      zIndex: 999999, display: 'flex', alignItems: 'flex-start',
      justifyContent: 'center', overflow: 'auto', padding: '40px 16px',
    });

    const rows = results.map((r) => {
      const s = r.sale;
      return `
        <tr style="background:#f6f8fa;font-weight:600">
          <td>Sale ${s.saleID}</td>
          <td>completed=${s.completed}</td>
          <td style="text-align:right">total ${s.total ?? ''}</td>
          <td>${s.timeStamp ?? ''}</td>
        </tr>
        <tr><td colspan="4" style="padding:0 0 8px">
          <div style="padding:8px 0 0">
            <div style="font-size:12px;color:#555;margin-bottom:4px">
              Active matching payments (${r.activePayments.length})
            </div>
            ${paymentTable(r.activePayments)}
            ${archivedPaymentSection(r.archivedPayments)}
          </div>
        </td></tr>`;
    }).join('');

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#fff', borderRadius: '8px', maxWidth: '900px', width: '100%',
      boxShadow: '0 10px 40px rgba(0,0,0,.3)', fontFamily: 'system-ui, sans-serif',
    });
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:14px 18px;border-bottom:1px solid #e1e4e8">
        <h2 style="margin:0;font-size:16px">
          Reserved Account Credit — Customer ${customerId}
        </h2>
        <button id="rac-close" style="border:none;background:#eee;border-radius:4px;
                cursor:pointer;padding:6px 10px">✕</button>
      </div>
      <div style="padding:14px 18px;font-size:13px;color:#333">
        <div style="margin-bottom:10px">
          <b>${results.length}</b> incomplete sale(s) with a paymentTypeID ${PAYMENT_TYPE_ID} payment.<br>
          Active matching credit: <b>${activeTotal.toFixed(2)}</b> ·
          Archived matching credit: <b>${archivedTotal.toFixed(2)}</b> ·
          Total matching credit: <b>${totalCredit.toFixed(2)}</b>
        </div>
        ${results.length
          ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
               <tbody>${rows}</tbody></table>`
          : `<div style="color:#888">No matches found.</div>`}
        <p style="margin-top:12px;color:#888">
          Archived payments are hidden in collapsed areas and can be expanded per sale.
          Full verbose payloads (sale + all payments) are logged to the console.
        </p>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    box.querySelector('#rac-close').addEventListener('click', () => overlay.remove());
  }

  // ---- main ----------------------------------------------------------------

  async function run() {
    const accountId = getAccountId();
    if (!accountId) return alert('Could not read window.merchantos.account.id');

    let customerId = getUrlCustomerId();
    const override = prompt(
      'Customer ID (leave blank to use the current customer on this page):',
      customerId || ''
    );
    if (override === null) return;               // cancelled
    if (override.trim()) customerId = override.trim();
    if (!customerId) return alert('No customer ID available.');

    try {
      const sales = await fetchIncompleteSalesWithPayments(accountId, customerId);
      const results = filterMatches(sales);

      console.group(`%cReserved Account Credit — customer ${customerId}`, 'font-weight:bold');
      console.log(`Incomplete sales scanned: ${sales.length}`);
      console.log(`Matches (paymentTypeID ${PAYMENT_TYPE_ID}): ${results.length}`);
      results.forEach((r) => {
        console.group(`Sale ${r.sale.saleID}`);
        console.log('sale (full payload):', r.sale);
        console.log('active matching payments:', r.activePayments);
        console.log('archived matching payments:', r.archivedPayments);
        console.log('all matching payments:', r.matchingPayments);
        console.log('all payments on sale:', r.allPayments);
        console.groupEnd();
      });
      console.log('Raw results object:', results);
      console.groupEnd();

      showModal(customerId, results);
    } catch (e) {
      console.error(e);
      alert('Error fetching sales — see console.');
    }
  }

  // ---- inject button -------------------------------------------------------

  function insertButton() {
    const bar = document.querySelector('#view > div > div.functions');
    if (!bar || document.getElementById('racFinderButton')) return;

    const btn = document.createElement('button');
    btn.id = 'racFinderButton';
    btn.title = 'Find reserved account credit (paymentTypeID 4)';
    btn.className = 'supplementary';
    btn.textContent = 'Find Reserved Credit';
    btn.addEventListener('click', (e) => { e.preventDefault(); run(); });
    bar.appendChild(btn);
  }

  if (!isCustomerCreditPage()) return;

  // The details tab loads async; retry until the functions bar exists
  const iv = setInterval(() => {
    insertButton();
    if (document.getElementById('racFinderButton')) clearInterval(iv);
  }, 500);
  setTimeout(() => clearInterval(iv), 30000);
})();