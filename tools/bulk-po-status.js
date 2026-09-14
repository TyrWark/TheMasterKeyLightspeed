(function () {
	'use strict';

	const LAUNCHER_ID = 'tm-pos-launcher';
	const OVERLAY_ID = 'tm-pos-overlay';

	// fnc differs per target status; "checkin" uses a dedicated endpoint, everything else re-saves the form.
	const STATUS_FNC = {
		open: 'save',
		ordered: 'save',
		checkin: 'po_mode_checkin',
		finished: 'save',
	};

	const STATUS_LABELS = {
		open: 'Open',
		ordered: 'Ordered',
		checkin: 'Checked In',
		finished: 'Finished',
	};

	function parseIds(raw) {
		return [...new Set(
			raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
		)];
	}

	// Some dofunction actions (e.g. po_mode_checkin) are only registered server-side when
	// ajax_view carries the originating listing context ("Function ... not defined" otherwise).
	function buildAjaxView(poId, title) {
		const params = new URLSearchParams(location.search);
		const sort = params.get('__sort') || 'purchase_id';
		const sortDir = params.get('__sort_dir') || 'ASC';
		return {
			count: 0,
			rec_num: 0,
			request: false,
			tab: 'main',
			name: 'purchase.views.purchase',
			record_id: Number(poId),
			title,
			stored_listing: {
				draw_all: false,
				draw_tab_only: false,
				name: 'purchase.listings.purchases',
				request: false,
				saved_search: {},
				sort,
				sort_dir: sortDir,
				count: 0,
				page: '1',
				page_count: 1,
				tab: 'single',
				display_search: true,
				display_advanced: '1',
				page_size: 15,
				max_size: 100,
				page_controls: true,
				is_child_list: false,
				title: 'Purchase Orders',
				deleted_rows: null,
			},
		};
	}

	// Scrapes the PO's own edit page for its real field values so a full-form save
	// doesn't blank out vendor/shipping/discount data that isn't being changed.
	async function setPurchaseOrderStatus(poId, status) {
		const fnc = STATUS_FNC[status];
		if (!fnc) throw new Error(`Unknown status "${status}"`);

		const viewUrl = `${location.origin}/?name=purchase.views.purchase&form_name=view&id=${poId}&tab=main`;

		const viewResp = await fetch(viewUrl, { credentials: 'include' });
		if (!viewResp.ok) throw new Error(`Failed to load PO ${poId}: HTTP ${viewResp.status}`);
		const html = await viewResp.text();
		const doc = new DOMParser().parseFromString(html, 'text/html');

		const val = (name) => doc.querySelector(`[name="${name}"]`)?.value ?? '';
		const title = doc.querySelector('title')?.textContent?.trim() || `Purchase: #${poId}`;
		const vendorId = val('vendor_id') || '0';

		const keyValues = {
			view_id: '',
			primary_id: String(poId),
			function__getMode: status,
			shop_id: val('shop_id'),
			vendor_id: vendorId,
			ref_num: val('ref_num'),
			create_time: val('create_time'),
			ship_instructions: val('ship_instructions'),
			'note_id.note_text': val('note_id.note_text'),
			has_shipments: val('has_shipments') || '1',
			shipping_cost_method: val('shipping_cost_method') || 'total',
			discount_method: val('discount_method') || 'total',
			discount_is_percent: val('discount_is_percent') || '1',
			discount_percent_value: val('discount_percent_value') || '0',
			discount_money_vendor_value: val('discount_money_vendor_value') || '0.00',
			ship_cost: val('ship_cost') || '0.00',
			other_cost: val('other_cost') || '0.00',
		};

		if (vendorId !== '0') {
			Object.assign(keyValues, {
				'vendor_id.account_number': val('vendor_id.account_number'),
				'vendor_id.contact_f_name': val('vendor_id.contact_f_name'),
				'vendor_id.contact_l_name': val('vendor_id.contact_l_name'),
				'vendor_id.note_id.note_text': val('vendor_id.note_id.note_text'),
				'vendor_id.contact_id.phone_work': val('vendor_id.contact_id.phone_work'),
				'vendor_id.contact_id.fax': val('vendor_id.contact_id.fax'),
				'vendor_id.contact_id.email': val('vendor_id.contact_id.email'),
				'vendor_id.contact_id.address1': val('vendor_id.contact_id.address1'),
				'vendor_id.contact_id.address2': val('vendor_id.contact_id.address2'),
				'vendor_id.contact_id.city': val('vendor_id.contact_id.city'),
				'vendor_id.contact_id.state': val('vendor_id.contact_id.state'),
				'vendor_id.contact_id.zip': val('vendor_id.contact_id.zip'),
			});
		}

		if (status === 'ordered') {
			Object.assign(keyValues, { checkin_quantity: '1', checkin_item_search: '' });
		} else {
			Object.assign(keyValues, {
				auto_add_all_category_id: '-1',
				auto_add_all_brand_id: '-1',
				is_margin_filter_enabled: 'false',
				auto_add_margin_threshold: '',
				add_item_search: '',
				add_item_show_all: 'off',
			});
		}

		const ajaxView = buildAjaxView(poId, title);

		const body = new URLSearchParams();
		body.set('method', 'POST');
		body.set('form_name', 'view.dofunction');
		body.set('ajax_view', JSON.stringify(ajaxView));
		body.set('fnc', fnc);
		body.set('key_values', JSON.stringify(keyValues));
		body.set('pannel_id', 'view');

		const saveResp = await fetch(
			`${location.origin}/ajax_forms.php?ajax=1&no_cache=${Date.now()}&form_name=view.dofunction`,
			{
				method: 'POST',
				credentials: 'include',
				mode: 'cors',
				headers: {
					'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'x-requested-with': 'XMLHttpRequest',
				},
				referrer: viewUrl,
				body: body.toString(),
			}
		);

		const text = await saveResp.text();
		if (!saveResp.ok) throw new Error(`HTTP ${saveResp.status}: ${text.slice(0, 200)}`);

		// The endpoint can return HTTP 200 + success:true while still reporting a failure via failed_msg.
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			return text;
		}
		if (data.failed_msg) throw new Error(data.failed_msg);
		return data.success_msg || text;
	}

	function ensureStyles() {
		if (document.getElementById('tm-pos-style')) return;
		const style = document.createElement('style');
		style.id = 'tm-pos-style';
		style.textContent = `
			#${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:#071e26aa;backdrop-filter:blur(4px)}
			#tm-pos-modal{width:min(560px,92vw);max-height:88vh;overflow:auto;border:1px solid #6a9b9c66;border-radius:16px;background:#f5f3ed;color:#17333b;box-shadow:0 24px 70px #071e2666;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
			#tm-pos-modal h2{margin:0;font-size:17px}
			#tm-pos-header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:15px 18px;background:#123b4a;color:#f6fbfa;border-radius:16px 16px 0 0}
			#tm-pos-header button{border:1px solid #77a6a4;background:transparent;color:#f6fbfa;border-radius:7px;padding:6px 10px;cursor:pointer}
			#tm-pos-body{padding:16px 18px;display:flex;flex-direction:column;gap:12px}
			#tm-pos-body label{font-weight:600;display:block;margin-bottom:5px}
			#tm-pos-ids{width:100%;box-sizing:border-box;min-height:90px;resize:vertical;border:1px solid #9bb5ad;border-radius:7px;background:#fffdf7;color:#17333b;padding:9px;font:inherit}
			#tm-pos-status{width:100%;box-sizing:border-box;border:1px solid #9bb5ad;border-radius:7px;background:#fffdf7;color:#17333b;padding:9px;font:inherit}
			.tm-pos-row{display:flex;align-items:center;gap:8px}
			#tm-pos-run{background:#1c5963;color:#fff;border:1px solid #77a6a4;border-radius:7px;padding:10px 14px;font:600 13px/1 inherit;cursor:pointer}
			#tm-pos-run:disabled{opacity:.55;cursor:not-allowed}
			#tm-pos-results{border:1px solid #d8d2c2;border-radius:9px;overflow:hidden}
			#tm-pos-results table{width:100%;border-collapse:collapse;font-size:12.5px}
			#tm-pos-results th,#tm-pos-results td{padding:6px 9px;text-align:left;border-bottom:1px solid #e3ddce}
			#tm-pos-results th{background:#e9e4d6}
			.tm-pos-pending{color:#7a6f4d}
			.tm-pos-ok{color:#186a3d;font-weight:600}
			.tm-pos-fail{color:#a4222a;font-weight:600}
			#tm-pos-summary{font-size:12.5px;color:#4c5a52}
		`;
		document.head.appendChild(style);
	}

	function attachLauncher() {
		if (document.getElementById(LAUNCHER_ID)) return true;

		const targetBtn = document.getElementById('newPurchaseOrderButton');
		if (!targetBtn) return false;

		const launcher = document.createElement('button');
		launcher.id = LAUNCHER_ID;
		launcher.type = 'button';
		launcher.className = 'custom_function gui-def-button';
		launcher.title = 'Bulk PO Status';
		launcher.innerHTML = '<i class="icon-list"></i> Bulk PO Status';

		launcher.addEventListener('click', () => {
			const overlay = document.getElementById(OVERLAY_ID);
			if (overlay) overlay.style.display = 'flex';
		});

		const parentLi = targetBtn.closest('li');
		if (parentLi) {
			const li = document.createElement('li');
			li.id = LAUNCHER_ID + '-item';
			li.appendChild(launcher);
			parentLi.insertAdjacentElement('afterend', li);
		} else {
			targetBtn.insertAdjacentElement('afterend', launcher);
		}
		return true;
	}

	function buildUI() {
		ensureStyles();

		if (!document.getElementById(OVERLAY_ID)) {
			const overlay = document.createElement('div');
			overlay.id = OVERLAY_ID;
			overlay.innerHTML = `
				<div id="tm-pos-modal">
					<div id="tm-pos-header">
						<h2>Bulk PO Status Changer</h2>
						<button id="tm-pos-close" type="button">✕</button>
					</div>
					<div id="tm-pos-body">
						<div>
							<label for="tm-pos-ids">Purchase Order IDs (comma, space, or newline separated)</label>
							<textarea id="tm-pos-ids" placeholder="32439, 43, 1029&#10;5501"></textarea>
						</div>
						<div class="tm-pos-row">
							<div style="flex:1">
								<label for="tm-pos-status">Set status to</label>
								<select id="tm-pos-status">
									<option value="open">Open</option>
									<option value="ordered">Ordered</option>
									<option value="checkin">Checked In</option>
									<option value="finished">Finished</option>
								</select>
							</div>
							<button id="tm-pos-run" type="button">Run</button>
						</div>
						<div id="tm-pos-summary"></div>
						<div id="tm-pos-results"></div>
					</div>
				</div>
			`;
			document.body.appendChild(overlay);

			const idsInput = overlay.querySelector('#tm-pos-ids');
			const statusSelect = overlay.querySelector('#tm-pos-status');
			const runBtn = overlay.querySelector('#tm-pos-run');
			const summaryEl = overlay.querySelector('#tm-pos-summary');
			const resultsEl = overlay.querySelector('#tm-pos-results');

			const close = () => { overlay.style.display = 'none'; };

			overlay.querySelector('#tm-pos-close').addEventListener('click', close);
			overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

			function renderResultsTable(rows) {
				const body = rows.map((r) => `
					<tr>
						<td>${r.id}</td>
						<td class="tm-pos-${r.state}">${r.state === 'pending' ? 'Working…' : r.state === 'ok' ? 'Success' : 'Failed'}</td>
						<td>${r.message}</td>
					</tr>
				`).join('');
				resultsEl.innerHTML = `
					<table>
						<thead><tr><th>PO ID</th><th>Status</th><th>Detail</th></tr></thead>
						<tbody>${body}</tbody>
					</table>
				`;
			}

			runBtn.addEventListener('click', async () => {
				const ids = parseIds(idsInput.value);
				if (!ids.length) {
					summaryEl.textContent = 'Enter at least one PO ID.';
					return;
				}
				const targetStatus = statusSelect.value;
				const rows = ids.map((id) => ({ id, state: 'pending', message: '' }));

				runBtn.disabled = true;
				summaryEl.textContent = `Setting ${ids.length} PO(s) to "${STATUS_LABELS[targetStatus]}"…`;
				renderResultsTable(rows);

				for (const row of rows) {
					try {
						const message = await setPurchaseOrderStatus(row.id, targetStatus);
						row.state = 'ok';
						row.message = message || STATUS_LABELS[targetStatus];
					} catch (err) {
						row.state = 'fail';
						row.message = err.message || String(err);
					}
					renderResultsTable(rows);
				}

				const okCount = rows.filter((r) => r.state === 'ok').length;
				const failCount = rows.length - okCount;
				summaryEl.textContent = `Done: ${okCount} succeeded, ${failCount} failed.`;
				runBtn.disabled = false;
			});
		}

		attachLauncher();
	}

	function teardownUI() {
		document.getElementById(LAUNCHER_ID + '-item')?.remove();
		document.getElementById(LAUNCHER_ID)?.remove();
		document.getElementById(OVERLAY_ID)?.remove();
	}

	// Detection is driven by the toolbar button's presence in the DOM rather than URL/pushState,
	// since this listing page doesn't reliably signal navigation through those.
	function syncForCurrentPage() {
		if (document.getElementById('newPurchaseOrderButton')) {
			buildUI();
		} else {
			teardownUI();
		}
	}

	let syncScheduled = false;
	function scheduleSync() {
		if (syncScheduled) return;
		syncScheduled = true;
		window.requestAnimationFrame(() => {
			syncScheduled = false;
			syncForCurrentPage();
		});
	}

	window.__mkl && window.__mkl.onRouteChange(scheduleSync);
	new MutationObserver(scheduleSync)
		.observe(document.documentElement || document.body, { childList: true, subtree: true });

	scheduleSync();
})();
