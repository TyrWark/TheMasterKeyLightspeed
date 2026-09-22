(function () {
	'use strict';

	// Lightspeed will not archive an item through a PUT: the `archived` field can only be set
	// back to false on update. Archiving is a DELETE on the item (which also zeroes inventory).
	// https://developers.lightspeedhq.com/retail/endpoints/Item/

	const STORAGE_KEYS = {
		dryRun: 'tm_item_bulk_dry_run',
	};

	const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

	const getAccountId = () =>
		(window.__mkl && typeof window.__mkl.getAccountId === 'function' ? window.__mkl.getAccountId() : null) ||
		pageWindow.merchantos?.account?.id ||
		document.querySelector('#help_account_id > var')?.textContent?.trim() ||
		null;

	const isDryRun = () => localStorage.getItem(STORAGE_KEYS.dryRun) !== 'false';
	const setDryRun = (value) => localStorage.setItem(STORAGE_KEYS.dryRun, value ? 'true' : 'false');

	const ITEM_TYPES = ['default', 'non_inventory', 'serialized', 'box', 'serialized_assembly', 'assembly'];

	// ---------------------------------------------------------------------
	// Target field catalog (drives the mapping <select> options)
	// A PUT is a partial update, so only mapped columns are ever sent.
	// ---------------------------------------------------------------------

	const FIELD_CATALOG = [
		{ group: 'Row Key', value: 'rowkey:systemSku', label: 'System ID / systemSku (row key)' },
		{ group: 'Row Key', value: 'rowkey:itemID', label: 'Item ID (row key, skips lookup)' },

		{ group: 'Item', value: 'text:description', label: 'Description' },
		{ group: 'Item', value: 'text:customSku', label: 'Custom SKU' },
		{ group: 'Item', value: 'text:manufacturerSku', label: 'Manufacturer SKU' },
		{ group: 'Item', value: 'text:upc', label: 'UPC (11-14 digits)' },
		{ group: 'Item', value: 'text:ean', label: 'EAN (11-14 digits)' },
		{ group: 'Item', value: 'float:defaultCost', label: 'Default Cost' },
		{ group: 'Item', value: 'enum:itemType', label: 'Item Type' },

		{ group: 'Flags', value: 'bool:tax', label: 'Taxable (true/false)' },
		{ group: 'Flags', value: 'bool:discountable', label: 'Discountable (true/false)' },
		{ group: 'Flags', value: 'bool:serialized', label: 'Serialized (true/false)' },
		{ group: 'Flags', value: 'bool:publishToEcom', label: 'Publish To eCom (true/false)' },

		{ group: 'Relations', value: 'int:categoryID', label: 'Category ID' },
		{ group: 'Relations', value: 'int:taxClassID', label: 'Tax Class ID' },
		{ group: 'Relations', value: 'int:manufacturerID', label: 'Manufacturer ID' },
		{ group: 'Relations', value: 'int:defaultVendorID', label: 'Default Vendor ID' },
		{ group: 'Relations', value: 'int:seasonID', label: 'Season ID' },

		{ group: 'Note', value: 'note:note', label: 'Note Text' },
		{ group: 'Note', value: 'note:isPublic', label: 'Note Is Public (true/false)' },

		{ group: 'Ignore', value: 'ignore', label: '-- Ignore this column --' },
	];

	const guessTarget = (headerName) => {
		const h = String(headerName).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
		const guesses = {
			systemsku: 'rowkey:systemSku',
			systemid: 'rowkey:systemSku',
			system: 'rowkey:systemSku',
			sku: 'rowkey:systemSku',
			itemid: 'rowkey:itemID',
			id: 'rowkey:itemID',
			description: 'text:description',
			name: 'text:description',
			customsku: 'text:customSku',
			manufacturersku: 'text:manufacturerSku',
			upc: 'text:upc',
			ean: 'text:ean',
			cost: 'float:defaultCost',
			defaultcost: 'float:defaultCost',
			itemtype: 'enum:itemType',
			tax: 'bool:tax',
			taxable: 'bool:tax',
			discountable: 'bool:discountable',
			serialized: 'bool:serialized',
			publishtoecom: 'bool:publishToEcom',
			categoryid: 'int:categoryID',
			taxclassid: 'int:taxClassID',
			manufacturerid: 'int:manufacturerID',
			defaultvendorid: 'int:defaultVendorID',
			seasonid: 'int:seasonID',
			note: 'note:note',
		};
		return guesses[h] || 'ignore';
	};

	// ---------------------------------------------------------------------
	// CSV parsing (handles quoted fields containing commas/newlines)
	// ---------------------------------------------------------------------

	const parseCsv = (text) => {
		const rows = [];
		let row = [];
		let field = '';
		let inQuotes = false;

		// Strip a UTF-8 BOM, common in CSVs exported from Excel.
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

		for (let i = 0; i < text.length; i += 1) {
			const c = text[i];

			if (inQuotes) {
				if (c === '"') {
					if (text[i + 1] === '"') {
						field += '"';
						i += 1;
					} else {
						inQuotes = false;
					}
				} else {
					field += c;
				}
				continue;
			}

			if (c === '"') {
				inQuotes = true;
			} else if (c === ',') {
				row.push(field);
				field = '';
			} else if (c === '\n' || c === '\r') {
				if (c === '\r' && text[i + 1] === '\n') i += 1;
				row.push(field);
				rows.push(row);
				row = [];
				field = '';
			} else {
				field += c;
			}
		}

		if (field.length || row.length) {
			row.push(field);
			rows.push(row);
		}

		return rows.filter((r) => r.some((v) => v !== ''));
	};

	const readTabularFile = async (file) => {
		if (!/\.xlsx?$/i.test(file.name)) return parseCsv(await file.text());
		if (typeof XLSX === 'undefined') throw new Error('Excel support failed to load; save the file as CSV instead.');

		const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
			.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))
			.filter((r) => r.some((v) => v !== ''));
	};

	// ---------------------------------------------------------------------
	// Fetch helper (session auth, same convention as the Customer CSV Mapper)
	// Adaptive throttle: ramps request spacing up/down based on Lightspeed's leaky-bucket
	// headers (x-ls-api-bucket-level, x-ls-api-burst-level, x-ls-api-drip-rate,
	// x-ls-api-request-cost) and backs off/retries on 429 instead of failing the row.
	// ---------------------------------------------------------------------

	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const rateLimiter = {
		delayMs: 300,
		floorMs: 0,
		bucketFraction: null,
		burstFraction: null,
	};

	const parseLevel = (headerValue) => {
		if (!headerValue) return null;
		const [usedStr, capStr] = headerValue.split('/');
		const used = parseFloat(usedStr);
		const cap = parseFloat(capStr);
		if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return null;
		return used / cap;
	};

	const updateRateLimiter = (headers) => {
		const bucketFraction = parseLevel(headers.get('x-ls-api-bucket-level'));
		const burstFraction = parseLevel(headers.get('x-ls-api-burst-level'));
		const dripRate = parseFloat(headers.get('x-ls-api-drip-rate'));
		const cost = parseFloat(headers.get('x-ls-api-request-cost'));

		if (bucketFraction != null) rateLimiter.bucketFraction = bucketFraction;
		if (burstFraction != null) rateLimiter.burstFraction = burstFraction;

		// Sustainable steady-state interval so ramp-down never overshoots the drip rate.
		if (Number.isFinite(dripRate) && dripRate > 0 && Number.isFinite(cost) && cost > 0) {
			rateLimiter.floorMs = (cost / dripRate) * 1000;
		}

		const fraction = burstFraction ?? bucketFraction;
		if (fraction == null) return;

		if (fraction > 0.75) {
			rateLimiter.delayMs = Math.min(5000, Math.max(rateLimiter.delayMs * 1.7, rateLimiter.floorMs) + 50);
		} else if (fraction < 0.35) {
			rateLimiter.delayMs = Math.max(rateLimiter.floorMs, rateLimiter.delayMs * 0.75 - 15);
		}
		// Middle zone: leave delayMs where it is (steady state).
	};

	const fetchJson = async (url, options = {}) => {
		const MAX_429_RETRIES = 6;

		for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
			if (rateLimiter.delayMs > 0) await sleep(rateLimiter.delayMs);

			const response = await fetch(url, {
				credentials: 'include',
				headers: {
					Accept: 'application/json, text/plain, */*',
					'Content-Type': 'application/json; charset=UTF-8',
					...(options.headers || {}),
				},
				...options,
			});

			updateRateLimiter(response.headers);

			if (response.status === 429) {
				const retryAfterSec = Number(response.headers.get('retry-after'));
				const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
					? retryAfterSec * 1000
					: Math.min(15000, 1000 * 1.8 ** attempt);
				rateLimiter.delayMs = Math.max(rateLimiter.delayMs * 2, rateLimiter.floorMs * 2, 500);
				console.warn(`[ItemBulkArchiver] 429 rate-limited, waiting ${backoffMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
				await sleep(backoffMs);
				continue;
			}

			const raw = await response.text();
			let data = null;
			try {
				data = raw ? JSON.parse(raw) : null;
			} catch (err) {
				data = raw || null;
			}

			if (!response.ok) {
				const message = (typeof data === 'object' ? (data?.message || data?.error) : data) || `HTTP ${response.status}`;
				throw new Error(message);
			}

			return data;
		}

		throw new Error('Rate limited (429) repeatedly; gave up retrying this request.');
	};

	const apiBase = (accountId) => `${location.origin}/API/V3/Account/${encodeURIComponent(accountId)}`;
	const itemUrl = (accountId, itemId) => `${apiBase(accountId)}/Item/${encodeURIComponent(itemId)}.json`;

	// ---------------------------------------------------------------------
	// Payload building
	// ---------------------------------------------------------------------

	const toBool = (value) => {
		const v = String(value ?? '').trim().toLowerCase();
		return ['true', 'yes', 'y', '1'].includes(v) ? 'true' : 'false';
	};

	const buildPayload = (row, mapping) => {
		const payload = {};
		const note = {};
		let noteTouched = false;

		for (const map of mapping) {
			if (!map.target || map.target === 'ignore' || map.target.startsWith('rowkey:')) continue;

			const trimmed = String(row[map.columnIndex] ?? '').trim();
			// Blank cell -> leave this field untouched. Literal "NULL" -> explicit wipe.
			if (trimmed === '') continue;
			const value = trimmed.toUpperCase() === 'NULL' ? '' : trimmed;

			const [kind, key] = map.target.split(':');

			switch (kind) {
				case 'text':
					payload[key] = value;
					break;
				case 'bool':
					payload[key] = toBool(value);
					break;
				case 'float': {
					if (value === '') { payload[key] = '0'; break; }
					const num = Number(value.replace(/[^0-9.\-]/g, ''));
					if (!Number.isFinite(num)) throw new Error(`"${value}" is not a valid number for ${key}`);
					payload[key] = String(num);
					break;
				}
				case 'int': {
					if (value === '') { payload[key] = '0'; break; }
					const num = parseInt(value, 10);
					if (!Number.isFinite(num)) throw new Error(`"${value}" is not a valid ID for ${key}`);
					payload[key] = String(num);
					break;
				}
				case 'enum': {
					if (!ITEM_TYPES.includes(value)) throw new Error(`"${value}" is not a valid itemType`);
					payload[key] = value;
					break;
				}
				case 'note':
					note[key] = key === 'isPublic' ? toBool(value) : value;
					noteTouched = true;
					break;
				default:
					break;
			}
		}

		if (noteTouched) payload.Note = note;
		return payload;
	};

	// ---------------------------------------------------------------------
	// Row processing
	// ---------------------------------------------------------------------

	const resolveItemId = async (accountId, systemSku) => {
		const url = `${apiBase(accountId)}/Item.json?systemSku=${encodeURIComponent(systemSku)}&limit=2&load_relations=%5B%5D`;
		const data = await fetchJson(url, { method: 'GET' });
		const found = data?.Item == null ? [] : (Array.isArray(data.Item) ? data.Item : [data.Item]);

		if (found.length === 0) throw new Error('No item matches that System ID');
		if (found.length > 1) throw new Error(`System ID matched ${found.length} items; refusing to guess`);
		return String(found[0].itemID);
	};

	const processRows = async (dataRows, mapping, options, onProgress) => {
		const {
			action = 'none',
			startRow = 2,
			maxConcurrent = 3,
			controller = { paused: false, stopped: false },
		} = options || {};

		const accountId = getAccountId();
		const dryRun = isDryRun();
		const keyMap = mapping.find((m) => m.target?.startsWith('rowkey:'));
		const keyIsItemId = keyMap.target === 'rowkey:itemID';

		const indices = [];
		for (let i = Math.max(0, startRow - 2); i < dataRows.length; i += 1) indices.push(i);

		// Serialize by row key so duplicate keys in one file can't run their
		// lookup/PUT/DELETE pipelines concurrently against the same item.
		const locks = new Map();
		const runExclusive = async (key, task) => {
			const prior = locks.get(key) || Promise.resolve();
			let release;
			const gate = new Promise((resolve) => { release = resolve; });
			const chained = prior.then(() => gate);
			locks.set(key, chained);
			await prior;
			try {
				return await task();
			} finally {
				release();
				if (locks.get(key) === chained) locks.delete(key);
			}
		};

		const processOne = async (i) => {
			const row = dataRows[i];
			const key = String(row[keyMap.columnIndex] ?? '').trim();
			const result = { rowNumber: i + 2, key, itemId: '', status: 'pending', message: '' };

			if (!key) {
				result.status = 'skipped';
				result.message = keyIsItemId ? 'Missing Item ID' : 'Missing System ID';
				return result;
			}

			return runExclusive(key, async () => {
				try {
					const payload = buildPayload(row, mapping);
					if (action === 'unarchive') payload.archived = 'false';

					const hasUpdate = Object.keys(payload).length > 0;
					if (!hasUpdate && action === 'none') {
						result.status = 'skipped';
						result.message = 'Nothing to update and no archive action selected';
						return result;
					}

					// Resolve first even on a dry run: it validates every System ID up front and is
					// the only thing that feeds the throttle readout with real bucket headers.
					const itemId = keyIsItemId ? key : await resolveItemId(accountId, key);
					result.itemId = itemId;

					if (dryRun) {
						result.status = 'dry-run';
						result.message = [
							hasUpdate ? `would PUT ${JSON.stringify(payload)}` : null,
							action === 'archive' ? 'would DELETE (archive)' : null,
						].filter(Boolean).join(' then ') || 'resolved only';
						return result;
					}

					const url = itemUrl(accountId, itemId);
					const done = [];

					if (hasUpdate) {
						await fetchJson(url, { method: 'PUT', body: JSON.stringify(payload) });
						done.push('updated');
					}
					// Archive last: a DELETE zeroes inventory, so any field edits land first.
					if (action === 'archive') {
						await fetchJson(url, { method: 'DELETE' });
						done.push('archived');
					} else if (action === 'unarchive') {
						done.push('unarchived');
					}

					result.status = action === 'archive' ? 'archived' : (action === 'unarchive' ? 'unarchived' : 'updated');
					result.message = done.join(' + ');
				} catch (error) {
					result.status = 'error';
					result.message = error?.message || String(error);
				}

				return result;
			});
		};

		const results = [];
		let completed = 0;
		let cursor = 0;

		// Rows that short-circuit (missing key, nothing to do) never reach fetchJson's sleep, so
		// the loop below could otherwise advance on microtasks alone and starve rendering.
		let lastYield = performance.now();
		const yieldToRender = async () => {
			if (performance.now() - lastYield < 50) return;
			await sleep(0);
			lastYield = performance.now();
		};

		const worker = async () => {
			for (;;) {
				if (controller.stopped) return;
				while (controller.paused && !controller.stopped) await sleep(150);
				if (controller.stopped) return;
				if (cursor >= indices.length) return;

				const idx = indices[cursor];
				cursor += 1;

				const result = await processOne(idx);
				results.push(result);
				completed += 1;
				onProgress?.(result, completed);
				await yieldToRender();
			}
		};

		const workerCount = Math.max(1, Math.min(maxConcurrent, indices.length || 1));
		await Promise.all(Array.from({ length: workerCount }, () => worker()));

		return results.sort((a, b) => a.rowNumber - b.rowNumber);
	};

	// ---------------------------------------------------------------------
	// UI
	// ---------------------------------------------------------------------

	const injectStyles = () => {
		if (document.getElementById('tm-ibu-styles')) return;
		const style = document.createElement('style');
		style.id = 'tm-ibu-styles';
		style.textContent = `
			#tm-ibu-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, Arial, sans-serif; }
			.tm-ibu-modal { background: #fff; color: #111; width: 90vw; max-width: 880px; max-height: 88vh; overflow: auto; border-radius: 8px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.35); display: flex; flex-direction: column; }
			.tm-ibu-modal h2 { margin: 0 0 6px; font-size: 18px; }
			.tm-ibu-modal p.tm-ibu-sub { margin: 0 0 14px; color: #555; font-size: 13px; }
			.tm-ibu-modal table { border-collapse: collapse; width: 100%; font-size: 13px; }
			.tm-ibu-modal th, .tm-ibu-modal td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
			.tm-ibu-modal th { background: #f5f5f5; position: sticky; top: 0; }
			.tm-ibu-modal select, .tm-ibu-modal input[type=number] { font-size: 12px; }
			.tm-ibu-modal td select { width: 100%; }
			.tm-ibu-sample { color: #777; font-size: 11px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			#tm-ibu-source { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
			#tm-ibu-paste { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font: 12px/1.5 'SFMono-Regular', Consolas, Menlo, monospace; padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
			#tm-ibu-footer { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
			#tm-ibu-footer label { font-size: 13px; display: inline-flex; align-items: center; gap: 5px; }
			.tm-ibu-modal button { padding: 8px 14px; border-radius: 6px; border: 1px solid #888; background: #f0f0f0; cursor: pointer; font-size: 13px; }
			.tm-ibu-modal button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
			.tm-ibu-modal button.danger { background: #d93025; color: #fff; border-color: #d93025; }
			.tm-ibu-modal button:disabled { opacity: .5; cursor: not-allowed; }
			#tm-ibu-status { white-space: pre-wrap; font-size: 12px; background: #f7f7f7; border: 1px solid #ddd; border-radius: 6px; padding: 8px; margin-top: 12px; }
			#tm-ibu-warn { font-size: 12px; background: #fff6e0; border: 1px solid #f0d089; border-radius: 6px; padding: 8px; margin-top: 12px; color: #7a5c00; }
			#tm-ibu-throttle { color: #555; font-size: 11px; margin-bottom: 6px; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
			#tm-ibu-track { background: #eee; border-radius: 999px; height: 10px; overflow: hidden; }
			#tm-ibu-fill { background: #1a73e8; height: 100%; width: 0%; transition: width .15s ease; }
			#tm-ibu-count { font-size: 12px; color: #555; margin: 6px 0 12px; }
			#tm-ibu-log { flex: 1; overflow: auto; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-size: 12px; background: #f7f7f7; border: 1px solid #ddd; border-radius: 6px; padding: 8px; min-height: 160px; }
			.tm-ibu-line { padding: 2px 0; border-bottom: 1px solid #eee; }
			.tm-ibu-line[data-status="updated"], .tm-ibu-line[data-status="archived"], .tm-ibu-line[data-status="unarchived"] { color: #0a7d2f; }
			.tm-ibu-line[data-status="dry-run"] { color: #8a6d00; }
			.tm-ibu-line[data-status="error"] { color: #c0392b; }
			.tm-ibu-line[data-status="skipped"] { color: #888; }
		`;
		document.head.appendChild(style);
	};

	const buildFieldSelect = (autoTarget) => {
		const select = document.createElement('select');
		let currentGroup = null;
		let optgroup = null;

		FIELD_CATALOG.forEach((field) => {
			if (field.group !== currentGroup) {
				currentGroup = field.group;
				optgroup = document.createElement('optgroup');
				optgroup.label = field.group;
				select.appendChild(optgroup);
			}
			const opt = document.createElement('option');
			opt.value = field.value;
			opt.textContent = field.label;
			optgroup.appendChild(opt);
		});

		select.value = autoTarget || 'ignore';
		if (!select.value) select.value = 'ignore';
		return select;
	};

	const downloadResultsCsv = (results) => {
		const cols = ['rowNumber', 'key', 'itemId', 'status', 'message'];
		const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const lines = [cols.join(',')].concat(results.map((r) => cols.map((c) => escape(r[c])).join(',')));
		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `item-bulk-results-${Date.now()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const openProgressModal = ({ total, accountId, dryRun, action }) => {
		injectStyles();

		const overlay = document.createElement('div');
		overlay.id = 'tm-ibu-overlay';

		const modal = document.createElement('div');
		modal.className = 'tm-ibu-modal';
		modal.innerHTML = `
			<h2>Updating Items</h2>
			<p class="tm-ibu-sub">Account: ${accountId} &middot; Action: ${action} &middot; Dry-run: ${dryRun ? 'ON' : 'OFF'}</p>
			<div id="tm-ibu-throttle">Throttle: warming up...</div>
			<div id="tm-ibu-track"><div id="tm-ibu-fill"></div></div>
			<div id="tm-ibu-count">0 / ${total}</div>
			<div id="tm-ibu-log"></div>
		`;

		const footer = document.createElement('div');
		footer.id = 'tm-ibu-footer';
		footer.style.justifyContent = 'flex-end';

		const pauseBtn = document.createElement('button');
		pauseBtn.textContent = 'Pause';
		const stopBtn = document.createElement('button');
		stopBtn.className = 'danger';
		stopBtn.textContent = 'Stop';
		const downloadBtn = document.createElement('button');
		downloadBtn.textContent = 'Download Results (CSV)';
		downloadBtn.disabled = true;
		const closeBtn = document.createElement('button');
		closeBtn.textContent = 'Close';
		closeBtn.disabled = true;
		closeBtn.addEventListener('click', () => overlay.remove());

		footer.append(pauseBtn, stopBtn, downloadBtn, closeBtn);
		modal.appendChild(footer);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);

		const fill = modal.querySelector('#tm-ibu-fill');
		const count = modal.querySelector('#tm-ibu-count');
		const log = modal.querySelector('#tm-ibu-log');
		const throttle = modal.querySelector('#tm-ibu-throttle');

		const controller = { paused: false, stopped: false };
		let allResults = [];

		pauseBtn.addEventListener('click', () => {
			controller.paused = !controller.paused;
			pauseBtn.textContent = controller.paused ? 'Resume' : 'Pause';
		});
		stopBtn.addEventListener('click', () => {
			controller.stopped = true;
			stopBtn.disabled = true;
			pauseBtn.disabled = true;
		});
		downloadBtn.addEventListener('click', () => downloadResultsCsv(allResults));

		return {
			controller,
			update(current) {
				fill.style.width = `${total ? Math.round((current / total) * 100) : 100}%`;
				count.textContent = `${current} / ${total}`;
			},
			updateThrottle() {
				const burstPct = rateLimiter.burstFraction != null ? `${Math.round(rateLimiter.burstFraction * 100)}%` : '?';
				const bucketPct = rateLimiter.bucketFraction != null ? `${Math.round(rateLimiter.bucketFraction * 100)}%` : '?';
				throttle.textContent = `Throttle: ${Math.round(rateLimiter.delayMs)}ms/request (burst ${burstPct}, bucket ${bucketPct})`;
			},
			log(result) {
				const line = document.createElement('div');
				line.className = 'tm-ibu-line';
				line.dataset.status = result.status;
				line.textContent = `Row ${result.rowNumber}, ${result.key || '?'}${result.itemId ? ` -> item ${result.itemId}` : ''}: ${result.status}${result.message ? ` (${result.message})` : ''}`;
				log.appendChild(line);
				while (log.childElementCount > 500) log.removeChild(log.firstChild);
				log.scrollTop = log.scrollHeight;
			},
			finish(summary, results) {
				allResults = results || [];
				pauseBtn.disabled = true;
				stopBtn.disabled = true;
				downloadBtn.disabled = allResults.length === 0;
				closeBtn.disabled = false;
				if (!summary) return;
				const line = document.createElement('div');
				line.className = 'tm-ibu-line';
				line.style.cssText = 'font-weight:600;border-top:2px solid #ccc;margin-top:4px;';
				line.textContent = summary;
				log.appendChild(line);
				log.scrollTop = log.scrollHeight;
			},
		};
	};

	const openSetupModal = () => new Promise((resolve, reject) => {
		injectStyles();

		const accountId = getAccountId();
		const overlay = document.createElement('div');
		overlay.id = 'tm-ibu-overlay';

		const modal = document.createElement('div');
		modal.className = 'tm-ibu-modal';
		modal.innerHTML = `
			<h2>Item Bulk Updater &amp; Archiver</h2>
			<p class="tm-ibu-sub">Paste System IDs, or load a CSV/Excel file and map its columns. Only mapped columns are sent &mdash; a PUT is a partial update, so unmapped item fields are left alone.</p>
			<div id="tm-ibu-source">
				<label>Paste System IDs (one per line)</label>
				<textarea id="tm-ibu-paste" placeholder="210000000020&#10;210000000021"></textarea>
				<div><input type="file" id="tm-ibu-file" accept=".csv,text/csv,.xlsx,.xls" /> <span class="tm-ibu-sample">Loading a file replaces the pasted list.</span></div>
			</div>
			<div id="tm-ibu-mapping"></div>
			<div id="tm-ibu-warn" hidden></div>
			<div id="tm-ibu-status">Account: ${accountId || 'UNKNOWN'}</div>
		`;

		const footer = document.createElement('div');
		footer.id = 'tm-ibu-footer';

		const actionSelect = document.createElement('select');
		actionSelect.innerHTML = `
			<option value="none">Update fields only</option>
			<option value="archive">Archive (DELETE)</option>
			<option value="unarchive">Unarchive (archived = false)</option>
		`;
		const actionLabel = document.createElement('label');
		actionLabel.append('Action: ', actionSelect);

		const dryRunInput = document.createElement('input');
		dryRunInput.type = 'checkbox';
		dryRunInput.checked = isDryRun();
		const dryRunLabel = document.createElement('label');
		dryRunLabel.title = 'Still resolves every System ID with a GET, but never sends a PUT or DELETE.';
		dryRunLabel.append(dryRunInput, 'Dry run');

		const startRowInput = document.createElement('input');
		startRowInput.type = 'number';
		startRowInput.min = '2';
		startRowInput.value = '2';
		startRowInput.style.width = '70px';
		const startRowLabel = document.createElement('label');
		startRowLabel.append('Start row: ', startRowInput);

		const concurrencyInput = document.createElement('input');
		concurrencyInput.type = 'number';
		concurrencyInput.min = '1';
		concurrencyInput.max = '10';
		concurrencyInput.value = '3';
		concurrencyInput.style.width = '60px';
		const concurrencyLabel = document.createElement('label');
		concurrencyLabel.append('Concurrency: ', concurrencyInput);

		const cancelBtn = document.createElement('button');
		cancelBtn.textContent = 'Cancel';
		const runBtn = document.createElement('button');
		runBtn.className = 'primary';
		runBtn.textContent = 'Run';

		footer.append(actionLabel, dryRunLabel, startRowLabel, concurrencyLabel, cancelBtn, runBtn);
		modal.appendChild(footer);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);

		const pasteEl = modal.querySelector('#tm-ibu-paste');
		const fileEl = modal.querySelector('#tm-ibu-file');
		const mappingEl = modal.querySelector('#tm-ibu-mapping');
		const statusEl = modal.querySelector('#tm-ibu-status');
		const warnEl = modal.querySelector('#tm-ibu-warn');

		let fileRows = null;
		let selects = [];

		const renderWarning = () => {
			if (actionSelect.value === 'archive') {
				warnEl.hidden = false;
				warnEl.textContent = 'Archiving is a DELETE. Lightspeed zeroes out the inventory of archived items and that cannot be undone without re-entering each inventory record.';
			} else {
				warnEl.hidden = true;
			}
		};
		actionSelect.addEventListener('change', renderWarning);

		const renderMapping = (headers, dataRows) => {
			mappingEl.innerHTML = '';
			selects = [];

			const table = document.createElement('table');
			table.innerHTML = '<thead><tr><th>CSV Column</th><th>Sample</th><th>Item Field</th></tr></thead>';
			const tbody = document.createElement('tbody');

			headers.forEach((header, index) => {
				const tr = document.createElement('tr');
				const sample = dataRows.slice(0, 3).map((r) => r[index]).filter((v) => String(v ?? '') !== '').join(' | ');
				const select = buildFieldSelect(guessTarget(header));
				selects.push({ columnIndex: index, select });

				const nameTd = document.createElement('td');
				nameTd.textContent = header;
				const sampleTd = document.createElement('td');
				sampleTd.className = 'tm-ibu-sample';
				sampleTd.textContent = sample;
				const selectTd = document.createElement('td');
				selectTd.appendChild(select);

				tr.append(nameTd, sampleTd, selectTd);
				tbody.appendChild(tr);
			});

			table.appendChild(tbody);
			mappingEl.appendChild(table);
		};

		fileEl.addEventListener('change', async () => {
			const file = fileEl.files?.[0];
			if (!file) return;
			try {
				const rows = await readTabularFile(file);
				if (rows.length < 2) throw new Error('File needs a header row plus at least one data row.');
				fileRows = rows;
				pasteEl.value = '';
				pasteEl.disabled = true;
				renderMapping(rows[0], rows.slice(1));
				statusEl.textContent = `Account: ${accountId || 'UNKNOWN'}\nLoaded ${rows.length - 1} data row(s) from ${file.name}.`;
			} catch (error) {
				fileRows = null;
				pasteEl.disabled = false;
				mappingEl.innerHTML = '';
				statusEl.textContent = `Could not read file: ${error.message || error}`;
			}
		});

		const cleanup = () => overlay.remove();
		cancelBtn.addEventListener('click', () => { cleanup(); reject(new Error('Cancelled')); });
		overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); reject(new Error('Cancelled')); } });

		runBtn.addEventListener('click', () => {
			if (!accountId) {
				statusEl.textContent = 'Could not determine the Lightspeed account ID. Open this from a logged-in Lightspeed page.';
				return;
			}

			let dataRows;
			let mapping;

			if (fileRows) {
				dataRows = fileRows.slice(1);
				mapping = selects.map((s) => ({ columnIndex: s.columnIndex, target: s.select.value }));
				const keys = mapping.filter((m) => m.target.startsWith('rowkey:'));
				if (keys.length !== 1) {
					statusEl.textContent = 'Map exactly one column as a row key (System ID or Item ID).';
					return;
				}
			} else {
				const ids = pasteEl.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
				if (!ids.length) {
					statusEl.textContent = 'Paste at least one System ID, or load a CSV file.';
					return;
				}
				dataRows = ids.map((id) => [id]);
				mapping = [{ columnIndex: 0, target: 'rowkey:systemSku' }];
			}

			const action = actionSelect.value;
			const hasFieldUpdates = mapping.some((m) => m.target !== 'ignore' && !m.target.startsWith('rowkey:'));
			if (action === 'none' && !hasFieldUpdates) {
				statusEl.textContent = 'Nothing to do: map at least one item field, or choose an Archive/Unarchive action.';
				return;
			}

			setDryRun(dryRunInput.checked);
			const startRow = fileRows ? Math.max(2, Number(startRowInput.value) || 2) : 2;

			cleanup();
			resolve({
				dataRows,
				mapping,
				action,
				startRow,
				maxConcurrent: Math.max(1, Math.min(10, Number(concurrencyInput.value) || 3)),
			});
		});

		renderWarning();
	});

	const runTool = async () => {
		try {
			const config = await openSetupModal();
			const accountId = getAccountId();
			const dryRun = isDryRun();
			const rowCount = Math.max(0, config.dataRows.length - (config.startRow - 2));

			const proceed = confirm(
				`Ready to process ${rowCount} row(s).\nAccount: ${accountId}\nAction: ${config.action}\nDry-run: ${dryRun ? 'ON' : 'OFF'}\nConcurrency: ${config.maxConcurrent}`
			);
			if (!proceed) return;

			const progress = openProgressModal({ total: rowCount, accountId, dryRun, action: config.action });
			const results = await processRows(config.dataRows, config.mapping, {
				action: config.action,
				startRow: config.startRow,
				maxConcurrent: config.maxConcurrent,
				controller: progress.controller,
			}, (result, completed) => {
				progress.log(result);
				progress.update(completed);
				progress.updateThrottle();
			});

			const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
			const stoppedNote = progress.controller.stopped ? ' (stopped early)' : '';
			progress.finish(
				`Done${stoppedNote}: ${Object.entries(counts).map(([status, n]) => `${status}=${n}`).join(', ')}`,
				results
			);
		} catch (error) {
			if (error?.message === 'Cancelled') return;
			alert(`Item bulk run failed: ${error?.message || String(error)}`);
			console.error('[ItemBulkArchiver] failed', error);
		}
	};

	// ---------------------------------------------------------------------
	// Launcher
	// ---------------------------------------------------------------------

	const LAUNCHER_ID = 'tm-ibu-launcher';

	// Only the inventory tab's section menu (?form_name=ui_tab&tab=inventory) renders the
	// option list; inner listings reuse data-tab="inventory" but replace the menu entirely.
	const isInventoryTab = () =>
		document.body?.dataset.tab === 'inventory' && document.body?.dataset.form_name === 'ui_tab';

	// Confirmed from a live DOM capture: #serialNumbersButton is the last <li> of
	// #inventory_inventory_section ul.options.
	const findAnchorItem = () => document.getElementById('serialNumbersButton')?.closest('li') || null;

	const addFloatingFallbackButton = () => {
		if (document.getElementById(LAUNCHER_ID) || !document.body) return;
		const btn = document.createElement('button');
		btn.id = LAUNCHER_ID;
		btn.type = 'button';
		btn.textContent = 'Item Bulk Updater';
		btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:999999;padding:10px 16px;border-radius:999px;border:none;background:#1a73e8;color:#fff;font:600 13px/1.1 -apple-system,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer;';
		btn.addEventListener('click', runTool);
		document.body.appendChild(btn);
	};

	const insertNavItem = (anchorItem) => {
		const li = document.createElement('li');
		li.id = LAUNCHER_ID;
		li.innerHTML = '<button type="button"><i class="icon-archive"></i><span data-automation="buttonTitle">Bulk Update / Archive</span></button><p class="explanation">Bulk update or archive items from a list of System IDs or a mapped CSV/Excel file.</p>';
		li.querySelector('button').addEventListener('click', (event) => {
			event.preventDefault();
			runTool();
		});
		anchorItem.insertAdjacentElement('afterend', li);
	};

	const ensureLauncher = () => {
		if (!isInventoryTab()) {
			document.getElementById(LAUNCHER_ID)?.remove();
			return;
		}

		const anchorItem = findAnchorItem();
		const existing = document.getElementById(LAUNCHER_ID);

		if (anchorItem) {
			if (existing && existing.previousElementSibling === anchorItem) return;
			existing?.remove();
			insertNavItem(anchorItem);
			return;
		}

		if (!existing) addFloatingFallbackButton();
	};

	let syncScheduled = false;
	const scheduleSync = () => {
		if (syncScheduled) return;
		syncScheduled = true;
		window.requestAnimationFrame(() => {
			syncScheduled = false;
			ensureLauncher();
		});
	};

	const init = () => {
		if (typeof GM_registerMenuCommand === 'function') {
			GM_registerMenuCommand('Open Item Bulk Updater / Archiver', runTool);
		}
		scheduleSync();
		window.__mkl && window.__mkl.onRouteChange(scheduleSync);
		new MutationObserver(scheduleSync).observe(document.body, {
			attributes: true,
			attributeFilter: ['data-tab', 'data-form_name'],
			childList: true,
			subtree: true,
		});
	};

	if (document.body) init();
	else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
