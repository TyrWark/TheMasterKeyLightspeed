(() => {
  'use strict';

  const API_LIMIT = 100;
  const BUTTON_ID = 'ls-category-audit-button';
  const BUTTON_ITEM_ID = 'ls-category-audit-button-item';
  const PANEL_ID = 'ls-category-audit-panel';
  const STYLE_ID = 'ls-category-audit-styles';
  const ANCHOR_ID = 'new_category_button';
  const BUTTON_LABEL = 'Audit Categories';

  const text = value => String(value ?? '').trim();
  const numeric = value => Number.parseInt(value, 10);

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function html(value) {
    return text(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function csv(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function relationObject(category) {
    return asArray(category.Category)[0] || null;
  }

  function listedParentPath(category) {
    const fullPath = text(category.fullPathName);
    const name = text(category.name);

    if (!fullPath || fullPath === name) {
      return '';
    }

    const suffix = `/${name}`;

    if (name && fullPath.endsWith(suffix)) {
      return fullPath.slice(0, -suffix.length);
    }

    const pieces = fullPath.split('/');
    pieces.pop();
    return pieces.join('/');
  }

  function addRelationChain(categoryMap, category) {
    const visited = new Set();
    let relation = relationObject(category);

    while (relation) {
      const id = text(relation.categoryID);

      if (!id || visited.has(id)) {
        break;
      }

      visited.add(id);

      if (!categoryMap.has(id)) {
        categoryMap.set(id, {
          ...relation,
          __recordSource: 'nested Category relation'
        });
      }

      relation = relationObject(relation);
    }
  }

  async function getCategories(accountId) {
    const categoriesById = new Map();
    const seenPages = new Set();

    let offset = 0;
    let expectedCount = Infinity;
    let pageCount = 0;

    while (
      categoriesById.size < expectedCount &&
      pageCount < 1000
    ) {
      const params = new URLSearchParams({
        load_relations: 'all',
        limit: String(API_LIMIT),
        offset: String(offset)
      });

      const url =
        `/API/Account/${encodeURIComponent(accountId)}` +
        `/Category.json?${params}`;

      const response = await fetch(url, {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(
          `Category request failed: HTTP ${response.status}`
        );
      }

      const payload = await response.json();
      const attributes = payload['@attributes'] || {};
      const page = asArray(payload.Category);

      expectedCount = Number.parseInt(
        attributes.count,
        10
      );

      if (!Number.isFinite(expectedCount)) {
        expectedCount = offset + page.length;
      }

      if (!page.length) {
        break;
      }

      const pageIds = page
        .map(category => text(category.categoryID))
        .filter(Boolean);

      const pageSignature = pageIds.join(',');

      if (seenPages.has(pageSignature)) {
        throw new Error(
          'The API returned the same page twice. ' +
          'Pagination was stopped to prevent duplicate processing.'
        );
      }

      seenPages.add(pageSignature);

      for (const category of page) {
        const id = text(category.categoryID);

        if (!id) continue;

        categoriesById.set(id, {
          ...category,
          __recordSource: 'pagination page'
        });

        addRelationChain(categoriesById, category);
      }

      pageCount++;

      const responseOffset = numeric(attributes.offset);

      const nextOffset = Number.isFinite(responseOffset)
        ? responseOffset + page.length
        : offset + page.length;

      if (nextOffset <= offset) {
        throw new Error(
          'The API did not advance the pagination offset.'
        );
      }

      offset = nextOffset;
    }

    const categories = [...categoriesById.values()];

    return {
      categories,
      pageCount,
      expectedCount,
      categoryCount: categories.length,
      complete: categories.length >= expectedCount
    };
  }

  function buildPhysicalParentMap(categories) {
    const entries = categories
      .map(category => ({
        category,
        id: text(category.categoryID),
        left: numeric(category.leftNode),
        right: numeric(category.rightNode),
        depth: numeric(category.nodeDepth)
      }))
      .filter(entry =>
        entry.id &&
        Number.isFinite(entry.left) &&
        Number.isFinite(entry.depth)
      );

    const physicalParents = new Map();

    // Prefer actual nested-set containment.
    for (const child of entries) {
      const possibleParents = entries
        .filter(parent =>
          parent.id !== child.id &&
          Number.isFinite(parent.right) &&
          parent.left < child.left &&
          parent.right > child.right
        )
        .sort((a, b) => {
          const aSize = a.right - a.left;
          const bSize = b.right - b.left;
          return aSize - bSize;
        });

      if (possibleParents.length) {
        physicalParents.set(child.id, {
          category: possibleParents[0].category,
          source: 'left/right containment'
        });
      }
    }

    // Fall back to combined listing order and nodeDepth.
    const sorted = [...entries].sort((a, b) => {
      const leftDifference = a.left - b.left;

      if (leftDifference !== 0) {
        return leftDifference;
      }

      return (b.right || 0) - (a.right || 0);
    });

    const stack = [];

    for (const entry of sorted) {
      while (
        stack.length &&
        stack[stack.length - 1].depth >= entry.depth
      ) {
        stack.pop();
      }

      const orderParent =
        entry.depth > 0 &&
        stack.length &&
        stack[stack.length - 1].depth === entry.depth - 1
          ? stack[stack.length - 1].category
          : null;

      if (
        orderParent &&
        !physicalParents.has(entry.id)
      ) {
        physicalParents.set(entry.id, {
          category: orderParent,
          source: 'combined listing order/nodeDepth'
        });
      }

      stack.push(entry);
    }

    return physicalParents;
  }

  function analyzeCategories(categories) {
    const byId = new Map();
    const byPath = new Map();
    const physicalParents =
      buildPhysicalParentMap(categories);

    for (const category of categories) {
      const id = text(category.categoryID);
      const path = text(category.fullPathName);

      if (id) {
        byId.set(id, category);
      }

      if (path) {
        byPath.set(path, category);
      }
    }

    const allRows = [];

    for (const category of categories) {
      const id = text(category.categoryID);
      if (!id) continue;

      const parentId = text(category.parentID) || '0';
      const relation = relationObject(category);

      const relationParent =
        relation &&
        text(relation.categoryID) === parentId
          ? relation
          : null;

      const idParent = parentId === '0'
        ? null
        : byId.get(parentId) || relationParent;

      const physicalInfo =
        physicalParents.get(id) || null;

      const physicalParent =
        physicalInfo?.category || null;

      const listedPath =
        listedParentPath(category);

      const listedParent =
        (listedPath && byPath.get(listedPath)) ||
        (
          relationParent &&
          listedPath === text(relationParent.fullPathName)
            ? relationParent
            : null
        );

      const reasons = [];

      if (
        parentId !== '0' &&
        !idParent
      ) {
        reasons.push('parentID_not_found');
      }

      if (
        idParent &&
        physicalParent &&
        text(physicalParent.categoryID) !== parentId
      ) {
        reasons.push(
          'physical_parent_differs_from_parentID'
        );
      }

      if (
        idParent &&
        !physicalParent
      ) {
        reasons.push('physical_parent_is_none');
      }

      if (
        !idParent &&
        physicalParent
      ) {
        reasons.push(
          'physical_parent_exists_but_parentID_is_root'
        );
      }

      if (
        idParent &&
        listedPath !== text(idParent.fullPathName)
      ) {
        reasons.push(
          'listed_path_differs_from_parentID'
        );
      }

      if (
        relation &&
        text(relation.categoryID) !== parentId
      ) {
        reasons.push(
          'nested_Category_relation_differs_from_parentID'
        );
      }

      const depth = numeric(category.nodeDepth);
      const parentDepth = idParent
        ? numeric(idParent.nodeDepth)
        : -1;

      if (
        Number.isFinite(depth) &&
        (
          (parentId === '0' && depth !== 0) ||
          (idParent && depth !== parentDepth + 1)
        )
      ) {
        reasons.push('nodeDepth_inconsistent');
      }

      const left = numeric(category.leftNode);
      const right = numeric(category.rightNode);
      const parentLeft = idParent
        ? numeric(idParent.leftNode)
        : NaN;
      const parentRight = idParent
        ? numeric(idParent.rightNode)
        : NaN;

      if (
        idParent &&
        [left, right, parentLeft, parentRight]
          .every(Number.isFinite) &&
        (
          left <= parentLeft ||
          right >= parentRight ||
          left >= right
        )
      ) {
        reasons.push(
          'left_right_outside_ID_parent_range'
        );
      }

      allRows.push({
        id,
        name: text(category.name),
        fullPath: text(category.fullPathName),
        recordSource: text(
          category.__recordSource ||
          'pagination page'
        ),

        idParentId: parentId,
        idParentName: idParent
          ? text(idParent.name)
          : parentId === '0'
            ? 'None (root)'
            : '(not found)',
        idParentPath: idParent
          ? text(idParent.fullPathName)
          : '',

        physicalParentId: physicalParent
          ? text(physicalParent.categoryID)
          : '0',
        physicalParentName: physicalParent
          ? text(physicalParent.name)
          : 'None (no parent)',
        physicalParentPath: physicalParent
          ? text(physicalParent.fullPathName)
          : '(top level)',
        physicalParentSource: physicalInfo?.source || '',

        listedParentId: listedParent
          ? text(listedParent.categoryID)
          : '0',
        listedParentName: listedParent
          ? text(listedParent.name)
          : listedPath
            ? '(not found)'
            : 'None (root)',
        listedParentPath: listedPath || '(top level)',

        nodeDepth: text(category.nodeDepth),
        leftNode: text(category.leftNode),
        rightNode: text(category.rightNode),
        reasons
      });
    }

    allRows.sort((a, b) => {
      const difference =
        numeric(a.leftNode) - numeric(b.leftNode);

      return Number.isFinite(difference)
        ? difference
        : a.id.localeCompare(b.id);
    });

    return {
      allRows,
      findings: allRows.filter(row =>
        row.reasons.length > 0
      )
    };
  }

  function buildRepairPayload(row) {
    const parentId = text(row.idParentId);
    const name = text(row.name);

    const fullPathName =
      parentId === '0'
        ? name
        : `${text(row.idParentPath)}/${name}`;

    return {
      name,
      fullPathName,
      parentID: Number(parentId)
    };
  }

  async function repairCategory(accountId, row) {
    if (
      !row.id ||
      !row.idParentId ||
      row.reasons.includes('parentID_not_found')
    ) {
      throw new Error(
        'This category does not have a resolvable destination parent.'
      );
    }

    const payload = buildRepairPayload(row);

    const response = await fetch(
      `/API/V3/Account/${encodeURIComponent(accountId)}` +
      `/Category/${encodeURIComponent(row.id)}.json`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${responseText}`
      );
    }

    return responseText;
  }

  function downloadCsv(rows, accountId, filenameSuffix) {
    const headers = [
      'categoryID',
      'categoryName',
      'fullPathName',
      'recordSource',

      'ShouldBeParentID',
      'ShouldBeParentName',
      'ShouldBeParentPath',

      'PhysicalParentID',
      'PhysicalParentName',
      'PhysicalParentPath',
      'PhysicalParentSource',

      'ListedPathParentID',
      'ListedPathParentName',
      'ListedPathParentPath',

      'nodeDepth',
      'leftNode',
      'rightNode',
      'flags'
    ];

    const lines = [
      headers.map(csv).join(',')
    ];

    for (const row of rows) {
      lines.push([
        row.id,
        row.name,
        row.fullPath,
        row.recordSource,

        row.idParentId,
        row.idParentName,
        row.idParentPath,

        row.physicalParentId,
        row.physicalParentName,
        row.physicalParentPath,
        row.physicalParentSource,

        row.listedParentId,
        row.listedParentName,
        row.listedParentPath,

        row.nodeDepth,
        row.leftNode,
        row.rightNode,
        row.reasons.join('; ')
      ].map(csv).join(','));
    }

    const blob = new Blob(
      [lines.join('\r\n')],
      { type: 'text/csv;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      `category-audit-${accountId}-` +
      `${filenameSuffix}-` +
      `${new Date().toISOString().slice(0, 10)}.csv`;

    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function currentAccountId() {
    const masterKeyId =
      window.__mkl && typeof window.__mkl.getAccountId === 'function'
        ? window.__mkl.getAccountId()
        : null;

    return text(
      masterKeyId ||
      unsafeWindow?.merchantos?.account?.id
    );
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function parentDisplay(
    parentId,
    parentName,
    parentPath,
    source = ''
  ) {
    return `
      <strong>${html(parentId || '0')}</strong>
      · ${html(parentName)}
      <br>
      <small>${html(parentPath)}</small>
      ${
        source
          ? `<br><small>Source: ${html(source)}</small>`
          : ''
      }
    `;
  }

  async function refreshAudit(accountId) {
    const result = await getCategories(accountId);
    const analysis = analyzeCategories(result.categories);

    showPanel(
      accountId,
      result,
      analysis
    );
  }

  function showPanel(
    accountId,
    result,
    analysis
  ) {
    closePanel();

    const {
      pageCount,
      expectedCount,
      complete
    } = result;

    const {
      allRows,
      findings
    } = analysis;

    const panel = document.createElement('section');
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="ls-audit-header">
        <strong>
          Category audit · Account ${html(accountId)}
        </strong>
        <button data-action="close" title="Close">×</button>
      </div>

      <div class="ls-audit-summary">
        Combined ${allRows.length.toLocaleString()} categories
        from ${pageCount.toLocaleString()} API pages.
        API reported ${expectedCount.toLocaleString()} records.
        Found
        <strong>${findings.length.toLocaleString()}</strong>
        flagged records.

        ${
          complete
            ? ''
            : `
              <div class="ls-audit-warning">
                Warning: pagination may be incomplete.
              </div>
            `
        }
      </div>

      <div class="ls-audit-actions">
        <button data-action="download-all">
          Download Full CSV
        </button>

        <button
          data-action="download-findings"
          ${findings.length ? '' : 'disabled'}
        >
          Download Mismatches CSV
        </button>
      </div>

      <div class="ls-audit-table-wrap">
        ${
          findings.length
            ? `
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Should be under<br>(parentID)</th>
                    <th>Actually under<br>(physical tree)</th>
                    <th>Listed path says</th>
                    <th>Flags</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  ${findings.map(row => `
                    <tr>
                      <td>
                        <strong>${html(row.id)}</strong>
                        · ${html(row.name)}
                        <br>
                        <small>${html(row.fullPath)}</small>
                      </td>

                      <td>
                        ${parentDisplay(
                          row.idParentId,
                          row.idParentName,
                          row.idParentPath ||
                            '(top level)'
                        )}
                      </td>

                      <td class="${
                        row.physicalParentId !==
                        row.idParentId
                          ? 'ls-audit-mismatch'
                          : ''
                      }">
                        ${parentDisplay(
                          row.physicalParentId,
                          row.physicalParentName,
                          row.physicalParentPath,
                          row.physicalParentSource
                        )}
                      </td>

                      <td>
                        ${parentDisplay(
                          row.listedParentId,
                          row.listedParentName,
                          row.listedParentPath
                        )}
                      </td>

                      <td>
                        ${html(row.reasons.join(', '))}
                      </td>

                      <td>
                        ${
                          row.reasons.includes(
                            'parentID_not_found'
                          )
                            ? `
                              <span class="ls-audit-disabled">
                                No destination
                              </span>
                            `
                            : `
                              <button
                                data-action="fix"
                                data-category-id="${html(row.id)}"
                              >
                                Fix
                              </button>
                            `
                        }
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `
            : `
              <p class="ls-audit-good">
                No inconsistencies found.
              </p>
            `
        }
      </div>
    `;

    document.body.appendChild(panel);

    panel
      .querySelector('[data-action="close"]')
      .addEventListener('click', closePanel);

    panel
      .querySelector('[data-action="download-all"]')
      .addEventListener('click', () => {
        downloadCsv(
          allRows,
          accountId,
          'all-categories'
        );
      });

    panel
      .querySelector('[data-action="download-findings"]')
      ?.addEventListener('click', () => {
        downloadCsv(
          findings,
          accountId,
          'mismatches'
        );
      });

    panel
      .querySelectorAll('[data-action="fix"]')
      .forEach(button => {
        button.addEventListener('click', async () => {
          const categoryId =
            button.dataset.categoryId;

          const row = findings.find(
            finding => finding.id === categoryId
          );

          if (!row) return;

          const payload =
            buildRepairPayload(row);

          const approved = confirm(
            `Repair category ${row.id} · ${row.name}?\n\n` +
            `Current physical parent:\n` +
            `${row.physicalParentId} · ` +
            `${row.physicalParentName}\n\n` +
            `New parentID:\n` +
            `${payload.parentID} · ` +
            `${row.idParentName}\n\n` +
            `New fullPathName:\n` +
            `${payload.fullPathName}\n\n` +
            `A PUT request will be sent to MerchantOS.`
          );

          if (!approved) {
            return;
          }

          button.disabled = true;
          button.textContent = 'Fixing…';

          try {
            await repairCategory(accountId, row);
            await refreshAudit(accountId);
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Fix';
            alert(
              `Category ${row.id} was not repaired:\n\n` +
              error.message
            );
          }
        });
      });
  }

  function setButtonBusy(busy) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    button.disabled = busy;
    button.lastChild.textContent = busy
      ? ' Auditing…'
      : ` ${BUTTON_LABEL}`;
  }

  async function runAudit() {
    const accountId = currentAccountId();

    if (!accountId) {
      alert('Unable to determine the current account ID.');
      return;
    }

    setButtonBusy(true);

    try {
      await refreshAudit(accountId);
    } catch (error) {
      alert(`Category audit failed: ${error.message}`);
      console.error('[Category audit]', error);
    } finally {
      setButtonBusy(false);
    }
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      #${BUTTON_ID}:disabled {
        opacity: .65;
        cursor: wait;
      }

      #${PANEL_ID} {
        position: fixed;
        inset: 7vh 1vw;
        z-index: 2147483647;
        overflow: hidden;
        color: #172033;
        background: #fff;
        border: 1px solid #ccd3df;
        border-radius: 8px;
        box-shadow: 0 12px 40px #0005;
        font: 13px system-ui, sans-serif;
      }

      .ls-audit-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 18px;
        border-bottom: 1px solid #e3e7ee;
        font-size: 15px;
      }

      .ls-audit-header button {
        border: 0;
        background: transparent;
        font-size: 24px;
        cursor: pointer;
      }

      .ls-audit-summary,
      .ls-audit-actions {
        padding: 10px 18px;
      }

      .ls-audit-actions {
        display: flex;
        gap: 8px;
      }

      .ls-audit-actions button,
      .ls-audit-table-wrap button {
        padding: 7px 10px;
        cursor: pointer;
      }

      .ls-audit-table-wrap {
        height: calc(100% - 150px);
        overflow: auto;
        padding: 0 18px 18px;
      }

      .ls-audit-table-wrap table {
        width: 100%;
        border-collapse: collapse;
      }

      .ls-audit-table-wrap th,
      .ls-audit-table-wrap td {
        text-align: left;
        vertical-align: top;
        padding: 8px;
        border-bottom: 1px solid #e7eaf0;
      }

      .ls-audit-table-wrap th {
        position: sticky;
        top: 0;
        background: #f4f6fa;
      }

      .ls-audit-table-wrap small {
        color: #5d687a;
      }

      .ls-audit-mismatch {
        color: #a12622;
        background: #fff1f0;
        font-weight: 600;
      }

      .ls-audit-disabled {
        color: #7a8494;
      }

      .ls-audit-warning {
        margin-top: 6px;
        color: #8a4b00;
        font-weight: 600;
      }

      .ls-audit-good {
        color: #087443;
        font-weight: 600;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureButton(anchor) {
    if (document.getElementById(BUTTON_ID)) return;

    const anchorItem = anchor.closest('li');
    if (!anchorItem) return;

    addStyles();

    const item = document.createElement('li');
    item.id = BUTTON_ITEM_ID;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    // Inside the listing <form>; prevent default submit.
    button.type = 'button';
    button.title = BUTTON_LABEL;
    button.className = 'custom_function gui-def-button';
    button.innerHTML = '<i class="icon-search"></i>';
    button.append(` ${BUTTON_LABEL}`);
    button.addEventListener('click', event => {
      event.preventDefault();
      runAudit();
    });

    item.appendChild(button);
    anchorItem.after(item);
  }

  function teardown() {
    document.getElementById(BUTTON_ITEM_ID)?.remove();
    closePanel();
  }

  function syncControl() {
    syncScheduled = false;

    const anchor = document.getElementById(ANCHOR_ID);

    if (anchor) ensureButton(anchor);
    else teardown();
  }

  let syncScheduled = false;

  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(syncControl);
  }

  window.__mkl && window.__mkl.onRouteChange(scheduleSync);
  new MutationObserver(scheduleSync)
    .observe(document.documentElement || document.body, { childList: true, subtree: true });

  scheduleSync();
})();
