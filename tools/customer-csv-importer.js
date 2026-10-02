(function () {
	'use strict';

	const STORAGE_KEYS = {
		dryRun: 'tm_customer_csv_importer_dry_run',
		verifyWrites: 'tm_customer_csv_importer_verify_writes',
	};
	const getAccountId = () => window.__mkl?.getAccountId?.() || window.merchantos?.account?.id;
	const isDryRun = () => localStorage.getItem(STORAGE_KEYS.dryRun) !== 'false';
	const setDryRun = (value) => localStorage.setItem(STORAGE_KEYS.dryRun, value ? 'true' : 'false');
	const isVerifyWrites = () => localStorage.getItem(STORAGE_KEYS.verifyWrites) === 'true';
	const setVerifyWrites = (value) => localStorage.setItem(STORAGE_KEYS.verifyWrites, value ? 'true' : 'false');

	const FIELD_CATALOG = [
		{ group: 'Customer', value: 'flat:firstName', label: 'First Name' },
		{ group: 'Customer', value: 'flat:lastName', label: 'Last Name' },
		{ group: 'Customer', value: 'flat:dob', label: 'Date of Birth' },
		{ group: 'Customer', value: 'flat:title', label: 'Title' },
		{ group: 'Customer', value: 'flat:company', label: 'Company' },
		{ group: 'Customer', value: 'flat:companyRegistrationNumber', label: 'Company Registration Number' },
		{ group: 'Customer', value: 'flat:vatNumber', label: 'VAT Number' },
		{ group: 'Customer', value: 'flat:customerTypeID', label: 'Customer Type ID' },
		{ group: 'Customer', value: 'flat:discountID', label: 'Discount ID' },
		{ group: 'Customer', value: 'flat:taxCategoryID', label: 'Tax Category ID' },
		{ group: 'Contact Flags', value: 'contactFlag:noEmail', label: 'No Email (opt-out)' },
		{ group: 'Contact Flags', value: 'contactFlag:noMail', label: 'No Mail (opt-out)' },
		{ group: 'Contact Flags', value: 'contactFlag:noPhone', label: 'No Phone (opt-out)' },
		{ group: 'Contact Flags', value: 'contactText:custom', label: 'Custom (Contact Custom Field)' },
		{ group: 'Address', value: 'address:address1', label: 'Address Line 1' },
		{ group: 'Address', value: 'address:address2', label: 'Address Line 2' },
		{ group: 'Address', value: 'address:city', label: 'City' },
		{ group: 'Address', value: 'address:state', label: 'State' },
		{ group: 'Address', value: 'address:stateCode', label: 'State Code' },
		{ group: 'Address', value: 'address:zip', label: 'Zip/Postal Code' },
		{ group: 'Address', value: 'address:country', label: 'Country' },
		{ group: 'Address', value: 'address:countryCode', label: 'Country Code' },
		{ group: 'Phone - Home', value: 'phone:Home', label: 'Home Phone Number' },
		{ group: 'Phone - Work', value: 'phone:Work', label: 'Work Phone Number' },
		{ group: 'Phone - Mobile', value: 'phone:Mobile', label: 'Mobile Phone Number' },
		{ group: 'Phone - Pager', value: 'phone:Pager', label: 'Pager Number' },
		{ group: 'Phone - Fax', value: 'phone:Fax', label: 'Fax Number' },
		{ group: 'Email - Primary', value: 'email:Primary', label: 'Primary Email Address' },
		{ group: 'Email - Secondary', value: 'email:Secondary', label: 'Secondary Email Address' },
		{ group: 'Website', value: 'website:url', label: 'Website URL' },
		{ group: 'Note', value: 'note:note', label: 'Note Text' },
		{ group: 'Note', value: 'note:isPublic', label: 'Note Is Public (true/false)' },
		{ group: 'Ignore', value: 'ignore', label: '-- Ignore this column --' },
	];

	const parseCsv = (text) => {
		const rows = [];
		let row = [];
		let field = '';
		let inQuotes = false;
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
		for (let i = 0; i < text.length; i += 1) {
			const c = text[i];
			if (inQuotes) {
				if (c === '"') {
					if (text[i + 1] === '"') { field += '"'; i += 1; }
					else inQuotes = false;
				} else field += c;
				continue;
			}
			if (c === '"') inQuotes = true;
			else if (c === ',') { row.push(field); field = ''; }
			else if (c === '\n' || c === '\r') {
				if (c === '\r' && text[i + 1] === '\n') i += 1;
				row.push(field); rows.push(row); row = []; field = '';
			} else field += c;
		}
		if (field.length || row.length) { row.push(field); rows.push(row); }
		return rows.filter((values) => values.some((value) => value !== ''));
	};

	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const rateLimiter = { delayMs: 300, floorMs: 0, bucketFraction: null, burstFraction: null };
	const parseLevel = (value) => {
		if (!value) return null;
		const [usedText, capText] = value.split('/');
		const used = parseFloat(usedText);
		const cap = parseFloat(capText);
		return Number.isFinite(used) && Number.isFinite(cap) && cap > 0 ? used / cap : null;
	};
	const updateRateLimiter = (headers) => {
		const bucket = parseLevel(headers.get('x-ls-api-bucket-level'));
		const burst = parseLevel(headers.get('x-ls-api-burst-level'));
		const drip = parseFloat(headers.get('x-ls-api-drip-rate'));
		const cost = parseFloat(headers.get('x-ls-api-request-cost'));
		if (bucket != null) rateLimiter.bucketFraction = bucket;
		if (burst != null) rateLimiter.burstFraction = burst;
		if (Number.isFinite(drip) && drip > 0 && Number.isFinite(cost) && cost > 0) rateLimiter.floorMs = (cost / drip) * 1000;
		const fraction = burst ?? bucket;
		if (fraction == null) return;
		if (fraction > 0.75) rateLimiter.delayMs = Math.min(5000, Math.max(rateLimiter.delayMs * 1.7, rateLimiter.floorMs) + 50);
		else if (fraction < 0.35) rateLimiter.delayMs = Math.max(rateLimiter.floorMs, rateLimiter.delayMs * 0.75 - 15);
	};
	const fetchJson = async (url, options = {}) => {
		for (let attempt = 0; attempt <= 6; attempt += 1) {
			if (rateLimiter.delayMs > 0) await sleep(rateLimiter.delayMs);
			const response = await fetch(url, {
				credentials: 'include',
				headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json; charset=UTF-8', ...(options.headers || {}) },
				...options,
			});
			updateRateLimiter(response.headers);
			if (response.status === 429) {
				const retryAfter = Number(response.headers.get('retry-after'));
				const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(15000, 1000 * 1.8 ** attempt);
				rateLimiter.delayMs = Math.max(rateLimiter.delayMs * 2, rateLimiter.floorMs * 2, 500);
				await sleep(backoff);
				continue;
			}
			const raw = await response.text();
			let data = null;
			try { data = raw ? JSON.parse(raw) : null; } catch { data = raw || null; }
			if (!response.ok) {
				const message = (typeof data === 'object' ? data?.message || data?.error : data) || `HTTP ${response.status}`;
				throw new Error(message);
			}
			return data;
		}
		throw new Error('Rate limited (429) repeatedly; gave up retrying this request.');
	};

	const toBool = (value) => ['true', 'yes', 'y', '1'].includes(String(value ?? '').trim().toLowerCase()) ? 'true' : 'false';
	const normalizeDob = (value) => {
		const text = String(value ?? '').trim();
		return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+00:00` : text;
	};
	const upsertByUseType = (source, wrapperKey, useType, valueField, value) => {
		const current = source?.[wrapperKey];
		const list = Array.isArray(current) ? [...current] : (current ? [current] : []);
		const index = list.findIndex((entry) => entry?.useType === useType);
		if (index >= 0) list[index] = { ...list[index], [valueField]: value, useType };
		else list.push({ [valueField]: value, useType });
		return { [wrapperKey]: list.length === 1 ? list[0] : list };
	};

	const buildPayload = (row, mapping) => {
		const payload = {};
		const contact = {};
		const address = {};
		const note = {};
		let contactTouched = false;
		let addressTouched = false;
		let noteTouched = false;
		for (const map of mapping) {
			if (!map.target || map.target === 'ignore') continue;
			const raw = row[map.columnIndex];
			const trimmed = String(raw ?? '').trim();
			if (!trimmed) continue;
			const value = trimmed.toUpperCase() === 'NULL' ? '' : raw;
			const [kind, key] = map.target.split(':');
			if (kind === 'flat') payload[key] = key === 'dob' ? normalizeDob(value) : value;
			else if (kind === 'contactFlag') { contact[key] = toBool(value); contactTouched = true; }
			else if (kind === 'contactText') { contact[key] = value; contactTouched = true; }
			else if (kind === 'address') { address[key] = value; addressTouched = true; contactTouched = true; }
			else if (kind === 'phone') {
				contact.Phones = { ...(contact.Phones || {}), ...upsertByUseType(contact.Phones, 'ContactPhone', key, 'number', value) };
				contactTouched = true;
			} else if (kind === 'email') {
				contact.Emails = { ...(contact.Emails || {}), ...upsertByUseType(contact.Emails, 'ContactEmail', key, 'address', value) };
				contactTouched = true;
			} else if (kind === 'website') {
				contact.Websites = { ContactWebsite: { url: value } };
				contactTouched = true;
			} else if (kind === 'note') { note[key] = key === 'isPublic' ? toBool(value) : value; noteTouched = true; }
		}
		if (addressTouched) contact.Addresses = { ContactAddress: address };
		if (contactTouched) payload.Contact = contact;
		if (noteTouched) payload.Note = note;
		return payload;
	};

	const guessTarget = (header) => {
		const key = header.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
		const guesses = {
			firstname: 'flat:firstName', lastname: 'flat:lastName', dob: 'flat:dob', dateofbirth: 'flat:dob',
			title: 'flat:title', company: 'flat:company', vatnumber: 'flat:vatNumber',
			address: 'address:address1', address1: 'address:address1', address2: 'address:address2',
			city: 'address:city', state: 'address:state', statecode: 'address:stateCode', zip: 'address:zip', postalcode: 'address:zip',
			country: 'address:country', countrycode: 'address:countryCode', mobile: 'phone:Mobile', mobilephone: 'phone:Mobile',
			cellphone: 'phone:Mobile', homephone: 'phone:Home', workphone: 'phone:Work', fax: 'phone:Fax',
			email: 'email:Primary', emailaddress: 'email:Primary', secondaryemail: 'email:Secondary', website: 'website:url', url: 'website:url', note: 'note:note',
		};
		return guesses[key] || 'ignore';
	};

	const injectStyles = () => {
		if (document.getElementById('tm-cci-styles')) return;
		const style = document.createElement('style');
		style.id = 'tm-cci-styles';
		style.textContent = `
			#tm-cci-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:999999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,Arial,sans-serif; }
			#tm-cci-modal { background:#fff; color:#111; width:90vw; max-width:980px; max-height:88vh; overflow:auto; border-radius:8px; padding:20px; box-shadow:0 8px 32px rgba(0,0,0,.35); }
			#tm-cci-modal h2 { margin:0 0 6px; font-size:18px; } #tm-cci-modal p { margin:0 0 14px; color:#555; font-size:13px; }
			#tm-cci-modal table { border-collapse:collapse; width:100%; font-size:13px; } #tm-cci-modal th,#tm-cci-modal td { border:1px solid #ddd; padding:6px 8px; text-align:left; }
			#tm-cci-modal th { background:#f5f5f5; position:sticky; top:0; } #tm-cci-modal select { width:100%; font-size:12px; }
			#tm-cci-footer,#tm-cci-progress-footer { display:flex; align-items:center; gap:10px; margin-top:16px; flex-wrap:wrap; }
			#tm-cci-footer button,#tm-cci-progress-footer button { padding:8px 14px; border-radius:6px; border:1px solid #888; background:#f0f0f0; cursor:pointer; font-size:13px; }
			#tm-cci-footer button.primary { background:#1a73e8; color:#fff; border-color:#1a73e8; }
			#tm-cci-status { white-space:pre-wrap; font-size:12px; background:#f7f7f7; border:1px solid #ddd; border-radius:6px; padding:8px; margin-top:12px; }
			#tm-cci-progress-modal { background:#fff; color:#111; width:90vw; max-width:720px; max-height:82vh; border-radius:8px; padding:20px; display:flex; flex-direction:column; }
			#tm-cci-progress-log { flex:1; overflow:auto; font:12px monospace; background:#f7f7f7; border:1px solid #ddd; padding:8px; min-height:160px; }
			#tm-cci-progress-bar-track { background:#eee; border-radius:999px; height:10px; overflow:hidden; } #tm-cci-progress-bar-fill { background:#1a73e8; height:100%; width:0; }
			.tm-cci-line { padding:2px 0; border-bottom:1px solid #eee; } .tm-cci-line[data-status="created"],.tm-cci-line[data-status="verified"] { color:#0a7d2f; }
			.tm-cci-line[data-status="dry-run"] { color:#8a6d00; } .tm-cci-line[data-status="error"],.tm-cci-line[data-status="mismatch"] { color:#c0392b; }
		`;
		document.head.appendChild(style);
	};
	const buildFieldSelect = (target) => {
		const select = document.createElement('select');
		let groupName = null;
		let group;
		for (const field of FIELD_CATALOG) {
			if (field.group !== groupName) { groupName = field.group; group = document.createElement('optgroup'); group.label = groupName; select.appendChild(group); }
			const option = document.createElement('option'); option.value = field.value; option.textContent = field.label; group.appendChild(option);
		}
		select.value = target;
		return select;
	};
	const openMappingModal = (headers, dataRows) => new Promise((resolve, reject) => {
		injectStyles();
		const overlay = document.createElement('div'); overlay.id = 'tm-cci-overlay';
		const modal = document.createElement('div'); modal.id = 'tm-cci-modal';
		modal.innerHTML = `<h2>Map File Columns to New Customer Fields</h2><p>${dataRows.length} data row(s). Blank cells are omitted; type NULL to send an empty value. Every data row will create a new customer.</p>`;
		const table = document.createElement('table');
		table.innerHTML = '<thead><tr><th>CSV Column</th><th>Sample Value</th><th>Maps To</th></tr></thead>';
		const body = document.createElement('tbody');
		const selects = [];
		headers.forEach((header, index) => {
			const tr = document.createElement('tr');
			const name = document.createElement('td'); name.textContent = header;
			const sample = document.createElement('td'); sample.textContent = dataRows[0]?.[index] ?? '';
			const target = document.createElement('td');
			const select = buildFieldSelect(guessTarget(header)); select.dataset.columnIndex = String(index); selects.push(select); target.appendChild(select);
			tr.append(name, sample, target); body.appendChild(tr);
		});
		table.appendChild(body);
		const footer = document.createElement('div'); footer.id = 'tm-cci-footer';
		const dryLabel = document.createElement('label'); const dryCheck = document.createElement('input'); dryCheck.type = 'checkbox'; dryCheck.checked = isDryRun();
		dryCheck.addEventListener('change', () => setDryRun(dryCheck.checked)); dryLabel.append(dryCheck, ' Dry run (preview only)');
		const verifyLabel = document.createElement('label'); const verifyCheck = document.createElement('input'); verifyCheck.type = 'checkbox'; verifyCheck.checked = isVerifyWrites();
		verifyCheck.addEventListener('change', () => setVerifyWrites(verifyCheck.checked)); verifyLabel.append(verifyCheck, ' Verify created customers');
		const startLabel = document.createElement('label'); startLabel.textContent = 'Start at row: ';
		const startInput = document.createElement('input'); startInput.type = 'number'; startInput.min = '2'; startInput.value = '2'; startInput.style.width = '70px'; startLabel.appendChild(startInput);
		const concurrencyLabel = document.createElement('label'); concurrencyLabel.textContent = 'Max concurrent rows: ';
		const concurrencyInput = document.createElement('input'); concurrencyInput.type = 'number'; concurrencyInput.min = '1'; concurrencyInput.max = '20'; concurrencyInput.value = '5'; concurrencyInput.style.width = '60px'; concurrencyLabel.appendChild(concurrencyInput);
		const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => { overlay.remove(); reject(new Error('Cancelled')); });
		const run = document.createElement('button'); run.className = 'primary'; run.textContent = 'Create Customers';
		run.addEventListener('click', () => {
			const mapping = selects.map((select) => ({ columnIndex: Number(select.dataset.columnIndex), target: select.value }));
			if (!mapping.some((item) => item.target !== 'ignore')) { alert('Map at least one column to a customer field.'); return; }
			overlay.remove();
			resolve({ mapping, startRow: Math.max(2, Number(startInput.value) || 2), maxConcurrent: Math.min(20, Math.max(1, Number(concurrencyInput.value) || 1)) });
		});
		const status = document.createElement('div'); status.id = 'tm-cci-status'; status.textContent = 'Review mappings, then create new customers.';
		footer.append(dryLabel, verifyLabel, startLabel, concurrencyLabel, cancel, run);
		modal.append(table, footer, status); overlay.appendChild(modal); document.body.appendChild(overlay);
	});

	const valuesMatch = (expected, actual) => {
		if (expected === undefined) return true;
		if (expected && typeof expected === 'object') {
			if (Array.isArray(expected)) {
				const actualList = Array.isArray(actual) ? actual : (actual ? [actual] : []);
				return expected.every((entry) => actualList.some((candidate) => valuesMatch(entry, candidate)));
			}
			if (!actual || typeof actual !== 'object') return false;
			return Object.keys(expected).every((key) => valuesMatch(expected[key], actual[key]));
		}
		return String(expected) === String(actual);
	};
	const processRows = async (dataRows, mapping, options, onProgress) => {
		const { startRow, maxConcurrent, controller } = options;
		const accountId = getAccountId();
		const url = `https://us.merchantos.com/API/V3/Account/${accountId}/Customer.json`;
		const indexes = Array.from({ length: Math.max(0, dataRows.length - (startRow - 2)) }, (_, index) => index + startRow - 2);
		let cursor = 0;
		let completed = 0;
		const results = [];
		const worker = async () => {
			while (!controller.stopped) {
				while (controller.paused && !controller.stopped) await sleep(150);
				if (controller.stopped || cursor >= indexes.length) return;
				const index = indexes[cursor++];
				const payload = buildPayload(dataRows[index], mapping);
				const result = { rowNumber: index + 2, customerID: '', status: 'pending', message: '' };
				try {
					if (Object.keys(payload).length === 0) {
						result.status = 'skipped'; result.message = 'No mapped values in row';
					} else if (isDryRun()) {
						result.status = 'dry-run'; result.message = JSON.stringify(payload);
					} else {
						const created = await fetchJson(url, { method: 'POST', body: JSON.stringify(payload) });
						const customer = created?.Customer || created;
						result.customerID = String(customer?.customerID || '');
						result.status = 'created'; result.message = result.customerID ? `POST sent; Customer ID ${result.customerID}` : 'POST sent';
						if (isVerifyWrites() && result.customerID) {
							const fresh = await fetchJson(`${url.replace('.json', `/${encodeURIComponent(result.customerID)}.json`)}?load_relations=all`, { method: 'GET' });
							const matches = valuesMatch(payload, fresh?.Customer || {});
							result.status = matches ? 'verified' : 'mismatch';
							result.message = matches ? `Created and verified Customer ID ${result.customerID}` : `Created customer ${result.customerID}, but returned values did not match`;
						} else if (isVerifyWrites()) result.message += '; response had no customer ID to verify';
					}
				} catch (error) { result.status = 'error'; result.message = error?.message || String(error); }
				results.push(result); completed += 1; onProgress(result, completed);
			}
		};
		await Promise.all(Array.from({ length: Math.max(1, Math.min(maxConcurrent, indexes.length || 1)) }, () => worker()));
		return results.sort((a, b) => a.rowNumber - b.rowNumber);
	};

	const openProgress = (total, accountId) => {
		injectStyles();
		const overlay = document.createElement('div'); overlay.id = 'tm-cci-overlay';
		const modal = document.createElement('div'); modal.id = 'tm-cci-progress-modal';
		modal.innerHTML = `<h2>Importing Customers</h2><p>Account: ${accountId} &middot; Dry run: ${isDryRun() ? 'ON' : 'OFF'}</p><div id="tm-cci-progress-bar-track"><div id="tm-cci-progress-bar-fill"></div></div><p id="tm-cci-count">0 / ${total}</p><div id="tm-cci-progress-log"></div>`;
		const footer = document.createElement('div'); footer.id = 'tm-cci-progress-footer';
		const pause = document.createElement('button'); pause.textContent = 'Pause';
		const stop = document.createElement('button'); stop.textContent = 'Stop';
		const download = document.createElement('button'); download.textContent = 'Download Results (CSV)'; download.disabled = true;
		const close = document.createElement('button'); close.textContent = 'Close'; close.disabled = true; close.addEventListener('click', () => overlay.remove());
		footer.append(pause, stop, download, close); modal.appendChild(footer); overlay.appendChild(modal); document.body.appendChild(overlay);
		const controller = { paused: false, stopped: false };
		let allResults = [];
		pause.addEventListener('click', () => { controller.paused = !controller.paused; pause.textContent = controller.paused ? 'Resume' : 'Pause'; });
		stop.addEventListener('click', () => { controller.stopped = true; stop.disabled = true; pause.disabled = true; });
		download.addEventListener('click', () => {
			const columns = ['rowNumber', 'customerID', 'status', 'message'];
			const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
			const csv = [columns.join(','), ...allResults.map((row) => columns.map((key) => quote(row[key])).join(','))].join('\n');
			const link = document.createElement('a'); const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
			link.href = objectUrl; link.download = `customer-import-results-${Date.now()}.csv`; link.click(); URL.revokeObjectURL(objectUrl);
		});
		return {
			controller,
			log(result) { const line = document.createElement('div'); line.className = 'tm-cci-line'; line.dataset.status = result.status; line.textContent = `Row ${result.rowNumber}: ${result.status}${result.customerID ? ` (Customer ${result.customerID})` : ''}`; const log = modal.querySelector('#tm-cci-progress-log'); log.appendChild(line); while (log.childElementCount > 500) log.firstChild.remove(); log.scrollTop = log.scrollHeight; },
			update(current) { modal.querySelector('#tm-cci-count').textContent = `${current} / ${total}`; modal.querySelector('#tm-cci-progress-bar-fill').style.width = `${total ? Math.round(current / total * 100) : 100}%`; },
				finish(results) {
					allResults = results;
					pause.disabled = true;
					stop.disabled = true;
					download.disabled = results.length === 0;
					close.disabled = false;
					const counts = results.reduce((summary, result) => { summary[result.status] = (summary[result.status] || 0) + 1; return summary; }, {});
					const line = document.createElement('div');
					line.className = 'tm-cci-line';
					line.style.fontWeight = '600';
					line.textContent = `Done: ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ') || 'no rows processed'}`;
					modal.querySelector('#tm-cci-progress-log').appendChild(line);
				},
		};
	};

	const chooseDataFile = () => new Promise((resolve, reject) => {
		const input = document.createElement('input'); input.type = 'file';
		input.accept = '.csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'; input.style.display = 'none';
		input.addEventListener('change', () => { const file = input.files?.[0]; input.remove(); file ? resolve(file) : reject(new Error('No file selected')); });
		document.body.appendChild(input); input.click();
	});
	const readTabularFile = async (file) => {
		if (!/\.xlsx?$/i.test(file.name)) return parseCsv(await file.text());
		const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false, defval: '' });
		return rows.map((row) => row.map((cell) => cell == null ? '' : String(cell))).filter((row) => row.some((cell) => cell !== ''));
	};
	const runImport = async () => {
		try {
			const rows = await readTabularFile(await chooseDataFile());
			if (rows.length < 2) { alert('File must have a header row plus at least one data row.'); return; }
			const [headers, ...dataRows] = rows;
			const { mapping, startRow, maxConcurrent } = await openMappingModal(headers, dataRows);
			const accountId = getAccountId();
			if (!accountId) throw new Error('Could not determine the Lightspeed account ID.');
			const rowsToProcess = Math.max(0, dataRows.length - startRow + 2);
			const proceed = confirm(`Create new customers for ${rowsToProcess} row(s) starting at row ${startRow}?\nAccount: ${accountId}\nDry run: ${isDryRun() ? 'ON' : 'OFF'}\nVerify writes: ${isVerifyWrites() ? 'ON' : 'OFF'}\n\nThis tool only creates customers; it does not update or delete existing customers.`);
			if (!proceed) return;
			const progress = openProgress(rowsToProcess, accountId);
			const results = await processRows(dataRows, mapping, { startRow, maxConcurrent, controller: progress.controller }, (result, count) => { progress.log(result); progress.update(count); });
			progress.finish(results);
			if (results.length <= 2000) console.table(results);
		} catch (error) {
			if (error?.message === 'Cancelled') return;
			alert(`Customer import failed: ${error?.message || String(error)}`);
			console.error('Customer CSV importer failed', error);
		}
	};

	const LAUNCHER_ID = 'tm-cci-launcher';
	const OPTIONS_LIST_SELECTOR = '#customers_customers_section ul.options';
	const isCustomersTab = () => document.body?.dataset.tab === 'customers';
	const findOptionsList = () => document.querySelector(OPTIONS_LIST_SELECTOR) || Array.from(document.querySelectorAll('article.section > h2'))
		.find((heading) => heading.textContent.trim() === 'Customers')?.parentElement.querySelector('ul.options') || null;
	const addFloatingFallbackButton = () => {
		if (document.getElementById(LAUNCHER_ID) || !document.body) return;
		const button = document.createElement('button'); button.id = LAUNCHER_ID; button.type = 'button'; button.textContent = 'Import New Customers';
		button.style.cssText = 'position:fixed;right:18px;bottom:68px;z-index:999999;padding:10px 16px;border-radius:999px;border:none;background:#188038;color:#fff;font:600 13px/1.1 -apple-system,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;';
		button.addEventListener('click', runImport); document.body.appendChild(button);
	};
	const insertNavItem = (list) => {
		const item = document.createElement('li'); item.id = LAUNCHER_ID;
		item.innerHTML = '<button type="button" id="tm-cci-launcher-btn"><i class="icon-upload"></i><span data-automation="buttonTitle">Import New Customers</span></button><p class="explanation">Create new customer records from a CSV or Excel file.</p>';
		item.querySelector('button').addEventListener('click', (event) => { event.preventDefault(); runImport(); }); list.appendChild(item);
	};
	const ensureLauncher = () => {
		if (!isCustomersTab()) { document.getElementById(LAUNCHER_ID)?.remove(); return; }
		const list = findOptionsList(); const existing = document.getElementById(LAUNCHER_ID);
		if (list) { if (existing && list.contains(existing)) return; existing?.remove(); insertNavItem(list); }
		else if (!existing) addFloatingFallbackButton();
	};
	const init = () => {
		ensureLauncher();
		window.__mkl?.onRouteChange?.(ensureLauncher);
		new MutationObserver(() => ensureLauncher()).observe(document.body, { attributes: true, attributeFilter: ['data-tab'], childList: true, subtree: true });
	};
	if (document.body) init();
	else document.addEventListener('DOMContentLoaded', init, { once: true });
})();