(function () {
	'use strict';

	const PANEL_ID = 'tim-panel-root';
	const BUTTON_ID = 'tim-open-button';
	const BATCH_LIMIT = 100;
	const toArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

	function getAccountId() {
		const masterKeyAccountId = window.__mkl?.getAccountId?.();
		if (masterKeyAccountId) return String(masterKeyAccountId);
		const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
		return pageWindow.merchantos?.account?.id ? String(pageWindow.merchantos.account.id) : null;
	}

	function escapeHtml(value) {
		return String(value ?? '').replace(/[&<>"']/g, (character) => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
		})[character]);
	}

	function chunks(values, size) {
		const result = [];
		for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
		return result;
	}

	async function fetchJson(url, init = {}) {
		const response = await fetch(url, {
			credentials: 'same-origin',
			...init,
			headers: { Accept: 'application/json', ...init.headers }
		});
		const text = await response.text();
		let json = {};
		if (text) {
			try { json = JSON.parse(text); } catch (error) { throw new Error(`HTTP ${response.status}: ${text}`); }
		}
		if (!response.ok || json.httpCode) {
			const details = json.errors ? JSON.stringify(json.errors) : text || response.statusText;
			throw new Error(`HTTP ${json.httpCode || response.status}: ${details}`);
		}
		return json;
	}

	async function fetchTransfer(accountId, transferId) {
		const json = await fetchJson(
			`/API/V3/Account/${encodeURIComponent(accountId)}/Inventory/Transfer/${encodeURIComponent(transferId)}.json`
		);
		if (!json.Transfer) throw new Error('The response did not include a transfer.');
		return json.Transfer;
	}

	async function fetchTransferItems(accountId, transferId) {
		const basePath = `/API/V3/Account/${encodeURIComponent(accountId)}/Inventory/Transfer/${encodeURIComponent(transferId)}/TransferItems.json`;
		let nextUrl = `${basePath}?limit=100`;
		const items = [];
		const visited = new Set();
		while (nextUrl) {
			if (visited.has(nextUrl)) throw new Error('Transfer item pagination repeated the same page.');
			visited.add(nextUrl);
			const json = await fetchJson(nextUrl);
			items.push(...toArray(json.TransferItem));
			const next = json['@attributes']?.next;
			if (next) {
				const parsedNext = new URL(next, location.origin);
				nextUrl = `${parsedNext.pathname}${parsedNext.search}`;
			} else {
				nextUrl = '';
			}
		}
		return items;
	}

	async function postItems(accountId, transferId, action, items) {
		for (const batch of chunks(items, BATCH_LIMIT)) {
			await fetchJson(
				`/API/V3/Account/${encodeURIComponent(accountId)}/Inventory/Transfer/${encodeURIComponent(transferId)}/${action}.json`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ TransferItems: batch })
				}
			);
		}
	}

	function transferIdFromUrl() {
		const params = new URLSearchParams(location.search);
		const id = params.get('id') || params.get('transferID');
		return /^\d+$/.test(id || '') ? id : '';
	}

	function openPanel() {
		document.getElementById(PANEL_ID)?.remove();

		const root = document.createElement('div');
		root.id = PANEL_ID;
		root.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box;';
		root.innerHTML = `
			<div role="dialog" aria-modal="true" aria-labelledby="tim-title" style="width:min(1080px,100%);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#172033;border-radius:8px;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden;">
				<div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #dbe1e8;">
					<h2 id="tim-title" style="font-size:18px;margin:0;flex:1;">Transfer Item Manager</h2>
					<label for="tim-transfer-id" style="font-size:12px;font-weight:600;">Transfer ID</label>
					<input id="tim-transfer-id" inputmode="numeric" value="${escapeHtml(transferIdFromUrl())}" style="width:130px;padding:8px;border:1px solid #aeb8c5;border-radius:4px;" />
					<button id="tim-load" style="padding:9px 14px;border:0;border-radius:4px;background:#1769aa;color:#fff;font-weight:600;cursor:pointer;">Load</button>
					<button id="tim-close" title="Close" aria-label="Close" style="width:34px;height:34px;border:1px solid #c6ced8;border-radius:4px;background:#fff;font-size:20px;line-height:1;cursor:pointer;">&times;</button>
				</div>
				<div id="tim-summary" style="padding:10px 16px;min-height:20px;background:#f5f7fa;border-bottom:1px solid #dbe1e8;font-size:13px;">Enter a transfer ID to load its item lines.</div>
				<div style="overflow:auto;flex:1;min-height:260px;">
					<table style="width:100%;border-collapse:collapse;font-size:12px;">
						<thead style="position:sticky;top:0;background:#e9eef3;z-index:1;"><tr>
							<th style="padding:8px;text-align:center;"><input id="tim-select-all" type="checkbox" title="Select all for removal" disabled></th>
							<th style="padding:8px;text-align:left;">Item ID</th><th style="padding:8px;text-align:left;">Transfer Item ID</th>
							<th style="padding:8px;text-align:left;">To Send</th><th style="padding:8px;text-align:left;">To Receive</th>
							<th style="padding:8px;text-align:left;">Sent</th><th style="padding:8px;text-align:left;">Received</th><th style="padding:8px;text-align:left;">Comment</th>
						</tr></thead>
						<tbody id="tim-rows"><tr><td colspan="8" style="padding:36px;text-align:center;color:#667085;">No transfer loaded.</td></tr></tbody>
					</table>
				</div>
				<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid #dbe1e8;">
					<span id="tim-selection" style="flex:1;font-size:12px;color:#536273;">0 selected</span>
					<button id="tim-save" disabled style="padding:9px 14px;border:0;border-radius:4px;background:#18794e;color:#fff;font-weight:600;cursor:pointer;">Save Changes</button>
					<button id="tim-remove" disabled style="padding:9px 14px;border:0;border-radius:4px;background:#b42318;color:#fff;font-weight:600;cursor:pointer;">Remove Selected</button>
				</div>
			</div>`;
		document.body.appendChild(root);

		const idInput = root.querySelector('#tim-transfer-id');
		const loadButton = root.querySelector('#tim-load');
		const saveButton = root.querySelector('#tim-save');
		const removeButton = root.querySelector('#tim-remove');
		const selectAll = root.querySelector('#tim-select-all');
		const rowsElement = root.querySelector('#tim-rows');
		const summary = root.querySelector('#tim-summary');
		const selection = root.querySelector('#tim-selection');
		let currentTransferId = '';
		let editable = false;

		function setStatus(message, isError = false) {
			summary.textContent = message;
			summary.style.color = isError ? '#b42318' : '#344054';
		}

		function selectedRows() {
			return [...rowsElement.querySelectorAll('tr[data-item-id]')].filter((row) => row.querySelector('.tim-remove-check').checked);
		}

		function refreshControls() {
			const rows = [...rowsElement.querySelectorAll('tr[data-item-id]')];
			const selected = selectedRows().length;
			const changed = rows.filter((row) => row.querySelector('.tim-to-send').value !== row.dataset.originalToSend).length;
			selection.textContent = `${selected} selected${changed ? `; ${changed} changed` : ''}`;
			selectAll.checked = rows.length > 0 && selected === rows.length;
			selectAll.indeterminate = selected > 0 && selected < rows.length;
			saveButton.disabled = !editable || changed === 0;
			removeButton.disabled = !editable || selected === 0;
		}

		function renderRows(items) {
			if (!items.length) {
				rowsElement.innerHTML = '<tr><td colspan="8" style="padding:36px;text-align:center;color:#667085;">This transfer has no item lines.</td></tr>';
				selectAll.disabled = true;
				refreshControls();
				return;
			}
			rowsElement.innerHTML = items.map((item) => `
				<tr data-item-id="${escapeHtml(item.itemID)}" data-original-to-send="${escapeHtml(item.toSend)}" style="border-bottom:1px solid #e7ebf0;">
					<td style="padding:8px;text-align:center;"><input class="tim-remove-check" type="checkbox" ${editable ? '' : 'disabled'}></td>
					<td style="padding:8px;font-weight:600;">${escapeHtml(item.itemID)}</td>
					<td style="padding:8px;">${escapeHtml(item.transferItemID)}</td>
					<td style="padding:6px;"><input class="tim-to-send" type="number" min="0" step="1" value="${escapeHtml(item.toSend)}" ${editable ? '' : 'disabled'} style="width:90px;padding:6px;border:1px solid #aeb8c5;border-radius:4px;"></td>
					<td style="padding:8px;">${escapeHtml(item.toReceive)}</td><td style="padding:8px;">${escapeHtml(item.sent)}</td>
					<td style="padding:8px;">${escapeHtml(item.received)}</td><td style="padding:8px;max-width:280px;white-space:normal;">${escapeHtml(item.comment)}</td>
				</tr>`).join('');
			selectAll.disabled = !editable;
			rowsElement.querySelectorAll('input').forEach((input) => input.addEventListener('input', refreshControls));
			refreshControls();
		}

		async function loadTransfer() {
			const transferId = idInput.value.trim();
			if (!/^\d+$/.test(transferId) || Number(transferId) < 1) return setStatus('Enter a valid numeric transfer ID.', true);
			const accountId = getAccountId();
			if (!accountId) return setStatus('Could not determine the current Lightspeed account ID.', true);
			loadButton.disabled = true;
			saveButton.disabled = true;
			removeButton.disabled = true;
			setStatus(`Loading transfer ${transferId}...`);
			try {
				const [transfer, items] = await Promise.all([
					fetchTransfer(accountId, transferId),
					fetchTransferItems(accountId, transferId)
				]);
				currentTransferId = transferId;
				editable = transfer.status === 'open';
				renderRows(items);
				const route = `${transfer.sendingShopID || '?'} to ${transfer.receivingShopID || '?'}`;
				setStatus(`Transfer ${transferId}: ${items.length} item line${items.length === 1 ? '' : 's'}; ${route}; status ${transfer.status || 'unknown'}.${editable ? '' : ' Sent or received transfers are read-only.'}`);
			} catch (error) {
				currentTransferId = '';
				editable = false;
				rowsElement.innerHTML = '<tr><td colspan="8" style="padding:36px;text-align:center;color:#667085;">Unable to load transfer items.</td></tr>';
				setStatus(error.message || 'Failed to load transfer.', true);
			} finally {
				loadButton.disabled = false;
			}
		}

		async function saveChanges() {
			const accountId = getAccountId();
			const changed = [...rowsElement.querySelectorAll('tr[data-item-id]')]
				.filter((row) => row.querySelector('.tim-to-send').value !== row.dataset.originalToSend)
				.map((row) => ({ itemID: Number(row.dataset.itemId), toSend: Number(row.querySelector('.tim-to-send').value) }));
			if (changed.some((item) => !Number.isInteger(item.toSend) || item.toSend < 0)) return setStatus('To Send values must be whole numbers of zero or more.', true);
			saveButton.disabled = true;
			setStatus(`Updating ${changed.length} item line${changed.length === 1 ? '' : 's'}...`);
			try {
				await postItems(accountId, currentTransferId, 'UpdateItems', changed);
				await loadTransfer();
				setStatus(`Updated ${changed.length} item line${changed.length === 1 ? '' : 's'} successfully.`);
			} catch (error) { setStatus(error.message || 'Update failed.', true); refreshControls(); }
		}

		async function removeSelected() {
			const selected = selectedRows();
			if (!window.confirm(`Remove ${selected.length} item line${selected.length === 1 ? '' : 's'} from transfer ${currentTransferId}?`)) return;
			const accountId = getAccountId();
			const items = selected.map((row) => ({ itemID: Number(row.dataset.itemId) }));
			removeButton.disabled = true;
			setStatus(`Removing ${items.length} item line${items.length === 1 ? '' : 's'}...`);
			try {
				await postItems(accountId, currentTransferId, 'DeleteItems', items);
				await loadTransfer();
				setStatus(`Removed ${items.length} item line${items.length === 1 ? '' : 's'} successfully.`);
			} catch (error) { setStatus(error.message || 'Removal failed.', true); refreshControls(); }
		}

		root.querySelector('#tim-close').addEventListener('click', () => root.remove());
		root.addEventListener('click', (event) => { if (event.target === root) root.remove(); });
		loadButton.addEventListener('click', loadTransfer);
		idInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadTransfer(); });
		saveButton.addEventListener('click', saveChanges);
		removeButton.addEventListener('click', removeSelected);
		selectAll.addEventListener('change', () => {
			rowsElement.querySelectorAll('.tim-remove-check').forEach((checkbox) => { checkbox.checked = selectAll.checked; });
			refreshControls();
		});
		idInput.focus();
		if (idInput.value) loadTransfer();
	}

	function ensureListingButton() {
		if (document.getElementById(BUTTON_ID)) return;
		const transferizerButton = document.getElementById('tfz-open-button');
		const newTransferButton = document.getElementById('new_transfer_button');
		const anchorItem = (transferizerButton || newTransferButton)?.closest('li');
		if (!anchorItem) return;
		const item = document.createElement('li');
		item.innerHTML = `<button title="View and edit transfer item lines" id="${BUTTON_ID}" class="custom_function gui-def-button"><i class="icon-pencil"></i> Manage Items</button>`;
		item.querySelector('button').addEventListener('click', (event) => { event.preventDefault(); openPanel(); });
		anchorItem.insertAdjacentElement('afterend', item);
	}

	let syncScheduled = false;
	function scheduleSync() {
		if (syncScheduled) return;
		syncScheduled = true;
		requestAnimationFrame(() => { syncScheduled = false; ensureListingButton(); });
	}

	if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Open Transfer Item Manager', openPanel);
	window.__mkl?.onRouteChange?.(scheduleSync);
	new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true });
	scheduleSync();
})();