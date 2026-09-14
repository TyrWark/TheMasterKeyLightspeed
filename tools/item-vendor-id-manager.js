(function () {
	'use strict';

	const APP_ID = 'tm-vendor-id-manager';
	const OPEN_BTN_ID = 'tm-vendor-id-open-btn';
	let currentState = null;

	function getAccountId() {
		return document.querySelector('#help_account_id > var')?.textContent?.trim() || '';
	}

	function getItemIdFromUrl() {
		const url = new URL(window.location.href);
		return (url.searchParams.get('id') || '').trim();
	}

	function isItemDetailsPage() {
		const url = new URL(window.location.href);
		return url.searchParams.get('name') === 'item.views.item' && !!url.searchParams.get('id');
	}

	function isVendorNumsPage() {
		const url = new URL(window.location.href);
		return (
			url.searchParams.get('name') === 'item.views.item' &&
			url.searchParams.get('form_name') === 'view' &&
			url.searchParams.get('tab') === 'vendor_nums' &&
			!!url.searchParams.get('id')
		);
	}

	function removeApp() {
		document.getElementById(APP_ID)?.remove();
	}

	function removeLauncherButton() {
		document.getElementById(OPEN_BTN_ID)?.remove();
	}

	function buildItemUrl(accountId, itemId, withRelations) {
		const base = `${location.origin}/API/Account/${accountId}/Item/${itemId}.json`;
		if (!withRelations) return base;
		const rel = encodeURIComponent('["ItemVendorNums"]');
		return `${base}?load_relations=${rel}`;
	}

	async function fetchJson(url, options = {}) {
		const response = await fetch(url, {
			credentials: 'include',
			headers: {
				Accept: 'application/json, text/plain, */*',
				'Content-Type': 'application/json; charset=UTF-8',
				...(options.headers || {}),
			},
			...options,
		});

		const raw = await response.text();
		let data = null;
		try {
			data = raw ? JSON.parse(raw) : null;
		} catch (err) {
			data = raw;
		}

		if (!response.ok) {
			const msg = typeof data === 'object' ? (data?.message || data?.error || JSON.stringify(data)) : (data || `HTTP ${response.status}`);
			throw new Error(msg);
		}

		return data;
	}

	function normalizeVendorNums(itemData) {
		const src = itemData?.Item?.ItemVendorNums?.ItemVendorNum;
		if (!src) return [];
		const arr = Array.isArray(src) ? src : [src];
		return arr.map((v) => ({
			itemVendorNumID: String(v.itemVendorNumID || ''),
			value: String(v.value ?? ''),
			timeStamp: String(v.timeStamp ?? ''),
			cost: String(v.cost ?? ''),
			b2bCatalogUUID: String(v.b2bCatalogUUID ?? ''),
			itemID: String(v.itemID ?? ''),
			vendorID: String(v.vendorID ?? ''),
		}));
	}

	async function getAjaxListingForDelete(itemId) {
		const formData = new URLSearchParams();
		formData.set('method', 'POST');
		formData.set('form_name', 'listing.refresh');
		formData.set('ajax_listing', JSON.stringify({
			draw_all: true,
			draw_tab_only: false,
			name: 'item.listings.vendor_numbers',
			is_child_list: '1',
			display_search: '0',
			saved_search: { item_id: String(itemId) },
		}));
		formData.set('key_values', JSON.stringify({ item_id: String(itemId) }));
		formData.set('pannel_id', 'item_listings_vendor_nums_view');

		const response = await fetch(`${location.origin}/ajax_forms.php?ajax=1&form_name=listing.refresh`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			body: formData.toString(),
		});

		const data = await response.json();
		if (!response.ok) {
			throw new Error(`listing.refresh failed: HTTP ${response.status}`);
		}
		return data?.ajax_listing || {};
	}

	function buildAjaxListingStringForDelete(itemId, listingMeta) {
		return JSON.stringify({
			draw_all: false,
			draw_tab_only: false,
			name: 'item.listings.vendor_numbers',
			is_child_list: '1',
			display_search: '0',
			saved_search: { item_id: String(itemId) },
			sort: null,
			sort_dir: 'ASC',
			count: Number(listingMeta.count || 0),
			page: Number(listingMeta.page || 1),
			page_count: Number(listingMeta.page_count || 1),
			tab: 'single',
			display_advanced: false,
			page_size: 100,
			max_size: 100,
			page_controls: false,
			title: 'Vendor Numbers/IDs',
			deleted_rows: null,
			row_num: 1,
			rec_num: Number(listingMeta.count || 0),
		});
	}

	async function deleteVendorNumLegacy(itemId, row) {
		const listingMeta = await getAjaxListingForDelete(itemId);
		const ajaxListing = buildAjaxListingStringForDelete(itemId, listingMeta);

		const formData = new URLSearchParams();
		formData.set('method', 'POST');
		formData.set('form_name', 'listing.dofunction');
		formData.set('ajax_listing', ajaxListing);
		formData.set('fnc', 'delete_vendor_num');
		formData.set('key_values', JSON.stringify({ item_id: String(itemId) }));
		formData.set('row', JSON.stringify({
			archived: 0,
			vendor_num_id: Number(row.itemVendorNumID),
			item_id: Number(itemId),
			vendor_id: Number(row.vendorID || 0),
			vendor_name: '',
			vendor_num: String(row.value ?? ''),
			vendor_cost: String(row.cost ?? ''),
		}));
		formData.set('selected_records', '[]');
		formData.set('pannel_id', 'item_listings_vendor_nums_view');

		const response = await fetch(`${location.origin}/ajax_forms.php?ajax=1`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			body: formData.toString(),
		});

		const text = await response.text();
		if (!response.ok) {
			throw new Error(`Delete failed: HTTP ${response.status} ${text}`);
		}
	}

	function ensureStyles() {
		if (document.getElementById('tm-vendor-id-style')) return;
		const style = document.createElement('style');
		style.id = 'tm-vendor-id-style';
		style.textContent = `
			#${APP_ID} {
				position: fixed;
				top: 76px;
				right: 18px;
				width: 620px;
				max-height: 80vh;
				overflow: auto;
				background: #fff;
				border: 1px solid #d8dde6;
				border-radius: 10px;
				box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
				z-index: 99999;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			}
			#${APP_ID} .tm-head {
				position: sticky;
				top: 0;
				background: #f7fafc;
				border-bottom: 1px solid #e6ebf2;
				padding: 12px;
				display: flex;
				justify-content: space-between;
				align-items: center;
			}
			#${APP_ID} .tm-head-left { min-width: 0; }
			#${APP_ID} .tm-close {
				border: 1px solid #c4cedc;
				background: #fff;
				color: #38475a;
				border-radius: 6px;
				padding: 4px 8px;
				font-size: 12px;
				cursor: pointer;
			}
			#${APP_ID} .tm-close:hover { background: #f1f5fa; }
			#${APP_ID} .tm-title { font-size: 16px; font-weight: 700; color: #203040; }
			#${APP_ID} .tm-sub { font-size: 12px; color: #5a6573; margin-top: 3px; }
			#${APP_ID} .tm-body { padding: 12px; }
			#${APP_ID} .tm-row { margin-bottom: 10px; }
			#${APP_ID} .tm-btn {
				border: 1px solid #b8c2d1;
				background: #fff;
				color: #1f2e3c;
				border-radius: 6px;
				padding: 6px 10px;
				font-size: 12px;
				cursor: pointer;
			}
			#${APP_ID} .tm-btn:hover { background: #f3f7fb; }
			#${APP_ID} .tm-btn-danger { border-color: #d66; color: #8a1c1c; }
			#${APP_ID} .tm-btn-primary { border-color: #2767c6; color: #0e3d84; }
			#${APP_ID} table { width: 100%; border-collapse: collapse; font-size: 12px; }
			#${APP_ID} th, #${APP_ID} td { border: 1px solid #e5ebf3; padding: 6px; text-align: left; vertical-align: middle; }
			#${APP_ID} th { background: #f0f5fb; position: sticky; top: 89px; z-index: 2; }
			#${APP_ID} input[type="text"] {
				width: 100%;
				box-sizing: border-box;
				border: 1px solid #c6d0dd;
				border-radius: 4px;
				padding: 5px;
			}
			#${APP_ID} .tm-status { font-size: 12px; color: #334; white-space: pre-wrap; }
			#${APP_ID} .tm-empty { padding: 10px; color: #5a6573; background: #f8fafc; border: 1px dashed #ccd7e5; border-radius: 6px; }
			#${APP_ID} .tm-mut { color: #6a7787; }
			#${APP_ID} tr.tm-empty-value-row td { background: rgba(255, 191, 71, 0.22); }
		`;
		document.head.appendChild(style);
	}

	function createAppShell() {
		const app = document.createElement('div');
		app.id = APP_ID;
		app.innerHTML = `
			<div class="tm-head">
				<div class="tm-head-left">
					<div class="tm-title">Vendor ID Manager</div>
					<div class="tm-sub" id="tm-vim-context">Item -</div>
				</div>
				<button class="tm-close" id="tm-vim-close" type="button" title="Close">Close</button>
			</div>
			<div class="tm-body">
				<div class="tm-row">
					<button class="tm-btn tm-btn-primary" id="tm-vim-refresh">Reload Vendor IDs</button>
				</div>
				<div class="tm-row tm-status" id="tm-vim-status">Ready.</div>
				<div class="tm-row" id="tm-vim-content"></div>
			</div>
		`;
		document.body.appendChild(app);
		return app;
	}

	function setStatus(text) {
		const el = document.getElementById('tm-vim-status');
		if (el) el.textContent = text;
	}

	function renderVendorTable(state) {
		const container = document.getElementById('tm-vim-content');
		if (!container) return;

		if (!state.vendorNums.length) {
			container.innerHTML = '<div class="tm-empty">No ItemVendorNums found for this item.</div>';
			return;
		}

		const table = document.createElement('table');
		table.innerHTML = `
			<thead>
				<tr>
					<th>itemVendorNumID</th>
					<th>vendorID</th>
					<th>value</th>
					<th>cost</th>
					<th>timeStamp</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody></tbody>
		`;

		const tbody = table.querySelector('tbody');

		state.vendorNums.forEach((row) => {
			const tr = document.createElement('tr');
			tr.dataset.id = row.itemVendorNumID;
			if (!String(row.value || '').trim()) {
				tr.classList.add('tm-empty-value-row');
			}

			const safeTs = row.timeStamp || '';
			tr.innerHTML = `
				<td>${row.itemVendorNumID}</td>
				<td>${row.vendorID || ''}</td>
				<td>${escapeHtml(row.value)}</td>
				<td>${escapeHtml(row.cost)}</td>
				<td class="tm-mut">${escapeHtml(safeTs)}</td>
				<td>
					<button class="tm-btn tm-btn-danger" data-action="delete">Delete</button>
				</td>
			`;

			tbody.appendChild(tr);
		});

		container.innerHTML = '';
		container.appendChild(table);
	}

	function escapeHtml(str) {
		return String(str ?? '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#039;');
	}

	function findRowById(state, itemVendorNumID) {
		return state.vendorNums.find((v) => String(v.itemVendorNumID) === String(itemVendorNumID));
	}

	async function loadVendorNums(state) {
		setStatus('Loading vendor IDs...');
		const data = await fetchJson(buildItemUrl(state.accountId, state.itemId, true), { method: 'GET' });
		state.itemData = data;
		state.vendorNums = normalizeVendorNums(data);
		renderVendorTable(state);
		setStatus(`Loaded ${state.vendorNums.length} vendor ID record(s).`);
	}

	async function handleDeleteClick(state, tr) {
		const id = tr.dataset.id;
		const row = findRowById(state, id);
		if (!row) return;

		const confirmed = window.confirm(
			`Are you sure you want to delete itemVendorNumID ${id}?\n\nItem: ${state.itemId}\nVendor: ${row.vendorID || 'N/A'}\n\nThis cannot be undone.`
		);
		if (!confirmed) return;

		setStatus(`Deleting itemVendorNumID ${id} via listing.dofunction...`);
		await deleteVendorNumLegacy(state.itemId, row);
		setStatus(`Deleted itemVendorNumID ${id}. Reloading...`);
		await loadVendorNums(state);
	}

	function wireTableActions(state) {
		const container = document.getElementById('tm-vim-content');
		if (!container) return;

		container.addEventListener('click', async (ev) => {
			const target = ev.target;
			if (!(target instanceof HTMLElement)) return;
			const action = target.getAttribute('data-action');
			if (!action) return;

			const tr = target.closest('tr');
			if (!tr) return;

			target.setAttribute('disabled', 'true');
			try {
				if (action === 'delete') {
					await handleDeleteClick(state, tr);
				}
			} catch (err) {
				setStatus(`Error: ${err?.message || String(err)}`);
				console.error(err);
			} finally {
				target.removeAttribute('disabled');
			}
		});
	}

	async function openManager() {
		if (!isVendorNumsPage()) {
			setStatus('Open this tool from the Item > Vendor Numbers tab.');
			return;
		}

		const accountId = getAccountId();
		const itemId = getItemIdFromUrl();

		if (!accountId || !itemId) {
			console.warn('Vendor ID Manager: missing account ID or item ID.');
			return;
		}

		removeApp();
		ensureStyles();
		createAppShell();

		const context = document.getElementById('tm-vim-context');
		if (context) context.textContent = `Account ${accountId} | Item ${itemId}`;

		const state = {
			accountId,
			itemId,
			itemData: null,
			vendorNums: [],
		};
		currentState = state;

		const refreshBtn = document.getElementById('tm-vim-refresh');
		const closeBtn = document.getElementById('tm-vim-close');
		if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				removeApp();
				currentState = null;
			});
		}
		if (refreshBtn) {
			refreshBtn.addEventListener('click', async () => {
				refreshBtn.setAttribute('disabled', 'true');
				try {
					await loadVendorNums(state);
				} catch (err) {
					setStatus(`Error: ${err?.message || String(err)}`);
				} finally {
					refreshBtn.removeAttribute('disabled');
				}
			});
		}

		wireTableActions(state);

		try {
			await loadVendorNums(state);
		} catch (err) {
			setStatus(`Error: ${err?.message || String(err)}`);
			console.error(err);
		}
	}

	function ensureLauncherButton() {
		const functionsEl = document.querySelector('#view > div > div.functions') || document.querySelector('.functions');
		if (!functionsEl) return;
		if (document.getElementById(OPEN_BTN_ID)) return;

		const btn = document.createElement('button');
		btn.id = OPEN_BTN_ID;
		btn.type = 'button';
		btn.title = 'Vendor ID Manager';
		btn.className = 'custom_function gui-def-button supplementary';
		btn.textContent = 'Vendor ID Manager';
		btn.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			openManager();
		});

		functionsEl.appendChild(btn);
	}

	function syncUiToRoute() {
		if (isVendorNumsPage()) {
			ensureLauncherButton();
			return;
		}

		removeLauncherButton();
		removeApp();
		currentState = null;
	}

	function setupSpaListeners() {
		const triggerRouteCheck = () => {
			window.setTimeout(syncUiToRoute, 50);
		};

		// route hook is installed once by the master loader; subscribe instead of patching history ourselves
		window.__mkl && window.__mkl.onRouteChange(triggerRouteCheck);

		const observer = new MutationObserver(() => {
			if (isVendorNumsPage()) {
				ensureLauncherButton();
			}
		});

		observer.observe(document.body, { childList: true, subtree: true });
	}

	function init() {
		if (!isItemDetailsPage()) return;
		setupSpaListeners();
		syncUiToRoute();
	}

	if (typeof GM_registerMenuCommand === 'function') {
		GM_registerMenuCommand('Open Vendor ID Manager', () => {
			openManager();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
