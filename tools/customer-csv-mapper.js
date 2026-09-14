(function () {
	'use strict';

	const STORAGE_KEYS = {
		dryRun: 'tm_customer_csv_mapper_dry_run',
		verifyWrites: 'tm_customer_csv_mapper_verify_writes',
	};

	const getAccountId = () => window.merchantos.account.id;
	const isDryRun = () => localStorage.getItem(STORAGE_KEYS.dryRun) !== 'false';
	const setDryRun = (value) => localStorage.setItem(STORAGE_KEYS.dryRun, value ? 'true' : 'false');
	const isVerifyWrites = () => localStorage.getItem(STORAGE_KEYS.verifyWrites) === 'true';
	const setVerifyWrites = (value) => localStorage.setItem(STORAGE_KEYS.verifyWrites, value ? 'true' : 'false');

	// ---------------------------------------------------------------------
	// Target field catalog (drives the mapping <select> options)
	// ---------------------------------------------------------------------

	const FIELD_CATALOG = [
		{ group: 'Row Key', value: 'rowkey:customerID', label: 'Customer ID (row key, required)' },

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
		{ group: 'Customer', value: 'flat:archived', label: 'Archived (true/false)' },

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

	// ---------------------------------------------------------------------
	// Fetch helper (session-auth, same convention as CustomerUpdator script)
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
				console.warn(`[CustomerCSVMapper] 429 rate-limited, waiting ${backoffMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
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

	const buildCustomerUrl = (accountId, customerId, includeRelations = false) => {
		const base = `https://us.merchantos.com/API/V3/Account/${accountId}/Customer/${customerId}.json`;
		return includeRelations ? `${base}?load_relations=all` : base;
	};

	// ---------------------------------------------------------------------
	// Nested-structure helpers for Contact sub-objects
	// ---------------------------------------------------------------------

	const toBool = (value) => {
		const v = String(value ?? '').trim().toLowerCase();
		return ['true', 'yes', 'y', '1'].includes(v) ? 'true' : 'false';
	};

	const normalizeDob = (value) => {
		const v = String(value ?? '').trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00+00:00`;
		return v;
	};

	// Upserts a single typed entry (phone/email) keyed by useType, preserving any
	// other existing entries of different useTypes. Existing shape can be a single
	// object, an array, or an empty string (per Lightspeed's inconsistent GET shape).
	const upsertByUseType = (existingWrapperValue, wrapperKey, useType, valueField, value) => {
		const existing = existingWrapperValue && typeof existingWrapperValue === 'object' ? existingWrapperValue[wrapperKey] : null;
		const list = Array.isArray(existing) ? [...existing] : (existing ? [existing] : []);

		const idx = list.findIndex((entry) => entry?.useType === useType);
		if (idx >= 0) {
			list[idx] = { ...list[idx], [valueField]: value, useType };
		} else {
			list.push({ [valueField]: value, useType });
		}

		return { [wrapperKey]: list.length === 1 ? list[0] : list };
	};

	// ---------------------------------------------------------------------
	// Build the PUT payload for one row, based on the confirmed mapping
	// ---------------------------------------------------------------------

	const buildPayload = (existingCustomerData, row, mapping) => {
		const customer = existingCustomerData?.Customer || {};
		const contact = customer.Contact && typeof customer.Contact === 'object' ? customer.Contact : {};
		const note = customer.Note && typeof customer.Note === 'object' ? customer.Note : {};

		const payload = { customerID: String(customer.customerID) };
		let contactTouched = false;
		let addressTouched = false;
		let noteTouched = false;

		const nextContact = { ...contact };
		const nextAddress = { ...(contact?.Addresses?.ContactAddress && typeof contact.Addresses.ContactAddress === 'object' && !Array.isArray(contact.Addresses.ContactAddress) ? contact.Addresses.ContactAddress : {}) };
		const nextNote = { ...note };

		for (const map of mapping) {
			if (!map.target || map.target === 'ignore' || map.target === 'rowkey:customerID') continue;

			const rawCell = row[map.columnIndex];
			const trimmedCell = String(rawCell ?? '').trim();
			// Blank cell -> leave this field untouched entirely. Literal "NULL" -> explicit wipe.
			if (trimmedCell === '') continue;
			const value = trimmedCell.toUpperCase() === 'NULL' ? '' : rawCell;

			const [kind, key] = map.target.split(':');

			switch (kind) {
				case 'flat': {
					if (key === 'archived') payload[key] = toBool(value);
					else if (key === 'dob') payload[key] = normalizeDob(value);
					else payload[key] = value;
					break;
				}
				case 'contactFlag': {
					nextContact[key] = toBool(value);
					contactTouched = true;
					break;
				}
				case 'contactText': {
					nextContact[key] = value;
					contactTouched = true;
					break;
				}
				case 'address': {
					nextAddress[key] = value;
					addressTouched = true;
					contactTouched = true;
					break;
				}
				case 'phone': {
					// Read/write nextContact.Phones (not contact.Phones) so multiple phone
					// columns in the same row accumulate instead of each overwriting the last.
					const source = nextContact.Phones && typeof nextContact.Phones === 'object' ? nextContact.Phones : {};
					const upserted = upsertByUseType(source, 'ContactPhone', key, 'number', value);
					nextContact.Phones = { ...source, ...upserted };
					contactTouched = true;
					break;
				}
				case 'email': {
					const source = nextContact.Emails && typeof nextContact.Emails === 'object' ? nextContact.Emails : {};
					const upserted = upsertByUseType(source, 'ContactEmail', key, 'address', value);
					nextContact.Emails = { ...source, ...upserted };
					contactTouched = true;
					break;
				}
				case 'website': {
					const existingWebsite = contact.Websites && typeof contact.Websites === 'object' ? contact.Websites.ContactWebsite : null;
					nextContact.Websites = { ContactWebsite: { ...(existingWebsite || {}), url: value } };
					contactTouched = true;
					break;
				}
				case 'note': {
					nextNote[key] = key === 'isPublic' ? toBool(value) : value;
					noteTouched = true;
					break;
				}
				default:
					break;
			}
		}

		if (addressTouched) {
			nextContact.Addresses = { ContactAddress: nextAddress };
		}
		if (contactTouched) {
			if (contact.contactID) nextContact.contactID = String(contact.contactID);
			payload.Contact = nextContact;
		}
		if (noteTouched) {
			payload.Note = nextNote;
		}

		return payload;
	};

	// ---------------------------------------------------------------------
	// Mapping UI (modal)
	// ---------------------------------------------------------------------

	const injectStyles = () => {
		if (document.getElementById('tm-ccm-styles')) return;
		const style = document.createElement('style');
		style.id = 'tm-ccm-styles';
		style.textContent = `
			#tm-ccm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, Arial, sans-serif; }
			#tm-ccm-modal { background: #fff; color: #111; width: 90vw; max-width: 980px; max-height: 88vh; overflow: auto; border-radius: 8px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.35); }
			#tm-ccm-modal h2 { margin: 0 0 6px; font-size: 18px; }
			#tm-ccm-modal p.tm-sub { margin: 0 0 14px; color: #555; font-size: 13px; }
			#tm-ccm-modal table { border-collapse: collapse; width: 100%; font-size: 13px; }
			#tm-ccm-modal th, #tm-ccm-modal td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
			#tm-ccm-modal th { background: #f5f5f5; position: sticky; top: 0; }
			#tm-ccm-modal select { width: 100%; font-size: 12px; }
			#tm-ccm-modal .tm-sample { color: #777; font-size: 11px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			#tm-ccm-footer { display: flex; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
			#tm-ccm-footer button { padding: 8px 14px; border-radius: 6px; border: 1px solid #888; background: #f0f0f0; cursor: pointer; font-size: 13px; }
			#tm-ccm-footer button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
			#tm-ccm-footer button.danger { background: #d93025; color: #fff; border-color: #d93025; }
			#tm-ccm-status { white-space: pre-wrap; font-size: 12px; background: #f7f7f7; border: 1px solid #ddd; border-radius: 6px; padding: 8px; margin-top: 12px; max-height: 220px; overflow: auto; }
			#tm-ccm-progress-modal { background: #fff; color: #111; width: 90vw; max-width: 720px; max-height: 82vh; border-radius: 8px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.35); display: flex; flex-direction: column; }
			#tm-ccm-progress-modal h2 { margin: 0 0 4px; font-size: 18px; }
			#tm-ccm-progress-meta { color: #555; font-size: 12px; margin-bottom: 10px; }
			#tm-ccm-progress-throttle { color: #555; font-size: 11px; margin-bottom: 6px; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
			#tm-ccm-progress-bar-track { background: #eee; border-radius: 999px; height: 10px; overflow: hidden; }
			#tm-ccm-progress-bar-fill { background: #1a73e8; height: 100%; width: 0%; transition: width .15s ease; }
			#tm-ccm-progress-count { font-size: 12px; color: #555; margin: 6px 0 12px; }
			#tm-ccm-progress-log { flex: 1; overflow: auto; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-size: 12px; background: #f7f7f7; border: 1px solid #ddd; border-radius: 6px; padding: 8px; min-height: 160px; }
			.tm-ccm-log-line { padding: 2px 0; border-bottom: 1px solid #eee; }
			.tm-ccm-log-line[data-status="updated"], .tm-ccm-log-line[data-status="verified"] { color: #0a7d2f; }
			.tm-ccm-log-line[data-status="dry-run"] { color: #8a6d00; }
			.tm-ccm-log-line[data-status="error"], .tm-ccm-log-line[data-status="mismatch"] { color: #c0392b; }
			.tm-ccm-log-line[data-status="skipped"] { color: #888; }
			#tm-ccm-progress-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
			#tm-ccm-progress-footer button { padding: 8px 14px; border-radius: 6px; border: 1px solid #888; background: #f0f0f0; cursor: pointer; font-size: 13px; }
			#tm-ccm-progress-footer button:disabled { opacity: .5; cursor: not-allowed; }
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
		if (select.value !== (autoTarget || 'ignore')) select.value = 'ignore';
		return select;
	};

	// Best-effort auto-suggestion so the reviewer has less manual work, never auto-applied blindly.
	const guessTarget = (headerName) => {
		const h = headerName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
		const guesses = {
			customerid: 'rowkey:customerID',
			custid: 'rowkey:customerID',
			firstname: 'flat:firstName',
			lastname: 'flat:lastName',
			dob: 'flat:dob',
			dateofbirth: 'flat:dob',
			title: 'flat:title',
			company: 'flat:company',
			vatnumber: 'flat:vatNumber',
			address1: 'address:address1',
			address: 'address:address1',
			address2: 'address:address2',
			city: 'address:city',
			state: 'address:state',
			statecode: 'address:stateCode',
			zip: 'address:zip',
			postalcode: 'address:zip',
			country: 'address:country',
			countrycode: 'address:countryCode',
			mobile: 'phone:Mobile',
			mobilephone: 'phone:Mobile',
			cellphone: 'phone:Mobile',
			homephone: 'phone:Home',
			workphone: 'phone:Work',
			fax: 'phone:Fax',
			email: 'email:Primary',
			emailaddress: 'email:Primary',
			secondaryemail: 'email:Secondary',
			website: 'website:url',
			url: 'website:url',
			note: 'note:note',
		};
		return guesses[h] || 'ignore';
	};

	const openMappingModal = (headers, dataRows) => new Promise((resolve, reject) => {
		injectStyles();

		const overlay = document.createElement('div');
		overlay.id = 'tm-ccm-overlay';

		const modal = document.createElement('div');
		modal.id = 'tm-ccm-modal';

		modal.innerHTML = `
			<h2>Map File Columns → Customer API Fields</h2>
			<p class="tm-sub">${dataRows.length} data row(s) detected. Review/adjust each mapping below. Exactly one column must be mapped to "Customer ID (row key)". Blank cells leave that field untouched; type NULL in a cell to explicitly wipe it.</p>
		`;

		const table = document.createElement('table');
		table.innerHTML = '<thead><tr><th>CSV Column</th><th>Sample Value</th><th>Maps To</th></tr></thead>';
		const tbody = document.createElement('tbody');

		const selects = [];
		headers.forEach((header, idx) => {
			const tr = document.createElement('tr');

			const tdHeader = document.createElement('td');
			tdHeader.textContent = header;

			const tdSample = document.createElement('td');
			tdSample.className = 'tm-sample';
			tdSample.textContent = dataRows[0]?.[idx] ?? '';

			const tdSelect = document.createElement('td');
			const select = buildFieldSelect(guessTarget(header));
			select.dataset.columnIndex = String(idx);
			selects.push(select);
			tdSelect.appendChild(select);

			tr.append(tdHeader, tdSample, tdSelect);
			tbody.appendChild(tr);
		});

		table.appendChild(tbody);

		const footer = document.createElement('div');
		footer.id = 'tm-ccm-footer';

		const dryRunLabel = document.createElement('label');
		dryRunLabel.style.fontSize = '13px';
		const dryRunCheckbox = document.createElement('input');
		dryRunCheckbox.type = 'checkbox';
		dryRunCheckbox.checked = isDryRun();
		dryRunCheckbox.addEventListener('change', () => setDryRun(dryRunCheckbox.checked));
		dryRunLabel.append(dryRunCheckbox, ' Dry run (no PUT sent, preview only)');

		const verifyLabel = document.createElement('label');
		verifyLabel.style.fontSize = '13px';
		const verifyCheckbox = document.createElement('input');
		verifyCheckbox.type = 'checkbox';
		verifyCheckbox.checked = isVerifyWrites();
		verifyCheckbox.addEventListener('change', () => setVerifyWrites(verifyCheckbox.checked));
		verifyLabel.append(verifyCheckbox, ' Verify writes (re-GET after PUT and confirm)');

		const startRowLabel = document.createElement('label');
		startRowLabel.style.fontSize = '13px';
		startRowLabel.textContent = 'Start at row: ';
		const startRowInput = document.createElement('input');
		startRowInput.type = 'number';
		startRowInput.min = '2';
		startRowInput.value = '2';
		startRowInput.style.width = '70px';
		startRowInput.title = 'Row number as shown in the log (2 = first data row). Use this to resume after a failed run.';
		startRowLabel.appendChild(startRowInput);

		const concurrencyLabel = document.createElement('label');
		concurrencyLabel.style.fontSize = '13px';
		concurrencyLabel.textContent = 'Max concurrent rows: ';
		const concurrencyInput = document.createElement('input');
		concurrencyInput.type = 'number';
		concurrencyInput.min = '1';
		concurrencyInput.max = '20';
		concurrencyInput.value = '5';
		concurrencyInput.style.width = '60px';
		concurrencyInput.title = 'Number of rows processed in parallel. 5-8 is a safe default for typical burst/drip limits; the throttle auto slows down if the API starts rate-limiting.';
		concurrencyLabel.appendChild(concurrencyInput);

		const accountLabel = document.createElement('label');
		accountLabel.style.fontSize = '13px';
		accountLabel.textContent = 'Account ID: ';
		const accountInput = document.createElement('input');
		accountInput.type = 'text';
		accountInput.value = getAccountId();
		accountInput.readOnly = true;
		accountInput.title = 'Always read from window.merchantos.account.id; not editable here.';
		accountInput.style.width = '110px';
		accountLabel.appendChild(accountInput);

		const cancelBtn = document.createElement('button');
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', () => {
			overlay.remove();
			reject(new Error('Cancelled'));
		});

		const runBtn = document.createElement('button');
		runBtn.className = 'primary';
		runBtn.textContent = 'Run With This Mapping';
		runBtn.addEventListener('click', () => {
			const mapping = selects.map((s) => ({ columnIndex: Number(s.dataset.columnIndex), target: s.value }));
			const rowKeyCount = mapping.filter((m) => m.target === 'rowkey:customerID').length;

			if (rowKeyCount !== 1) {
				alert('Exactly one column must be mapped to "Customer ID (row key)".');
				return;
			}

			overlay.remove();
			resolve({ mapping, startRow: Math.max(2, Number(startRowInput.value) || 2), maxConcurrent: Math.max(1, Number(concurrencyInput.value) || 1) });
		});

		const statusBox = document.createElement('div');
		statusBox.id = 'tm-ccm-status';
		statusBox.textContent = 'Adjust mappings above, then click "Run With This Mapping".';

		footer.append(dryRunLabel, verifyLabel, startRowLabel, concurrencyLabel, accountLabel, cancelBtn, runBtn);
		modal.append(table, footer, statusBox);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
	});

	// ---------------------------------------------------------------------
	// Live progress modal (progress bar + streaming per-row log)
	// ---------------------------------------------------------------------

	const downloadResultsCsv = (results) => {
		const cols = ['rowNumber', 'customerId', 'status', 'message'];
		const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const lines = [cols.join(',')].concat(results.map((r) => cols.map((c) => escape(r[c])).join(',')));
		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `customer-mapper-results-${Date.now()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const openProgressModal = ({ total, accountId, dryRun }) => {
		injectStyles();

		const overlay = document.createElement('div');
		overlay.id = 'tm-ccm-overlay';

		const modal = document.createElement('div');
		modal.id = 'tm-ccm-progress-modal';
		modal.innerHTML = `
			<h2>Updating Customers</h2>
			<div id="tm-ccm-progress-meta">Account: ${accountId} &middot; Dry-run: ${dryRun ? 'ON' : 'OFF'}</div>
			<div id="tm-ccm-progress-throttle">Throttle: warming up...</div>
			<div id="tm-ccm-progress-bar-track"><div id="tm-ccm-progress-bar-fill"></div></div>
			<div id="tm-ccm-progress-count">0 / ${total}</div>
			<div id="tm-ccm-progress-log"></div>
		`;

		const footer = document.createElement('div');
		footer.id = 'tm-ccm-progress-footer';

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

		const fill = modal.querySelector('#tm-ccm-progress-bar-fill');
		const count = modal.querySelector('#tm-ccm-progress-count');
		const log = modal.querySelector('#tm-ccm-progress-log');
		const throttle = modal.querySelector('#tm-ccm-progress-throttle');

		// Controller shared with processRows so Pause/Stop can interrupt the loop mid-run.
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
				const pct = total ? Math.round((current / total) * 100) : 100;
				fill.style.width = `${pct}%`;
				count.textContent = `${current} / ${total}`;
			},
			updateThrottle() {
				const burstPct = rateLimiter.burstFraction != null ? `${Math.round(rateLimiter.burstFraction * 100)}%` : '?';
				const bucketPct = rateLimiter.bucketFraction != null ? `${Math.round(rateLimiter.bucketFraction * 100)}%` : '?';
				throttle.textContent = `Throttle: ${Math.round(rateLimiter.delayMs)}ms/request (burst ${burstPct}, bucket ${bucketPct})`;
			},
			log(result) {
				const line = document.createElement('div');
				line.className = 'tm-ccm-log-line';
				line.dataset.status = result.status;
				line.textContent = `Row ${result.rowNumber}, Customer ${result.customerId || '?'}: ${result.status}`;
				log.appendChild(line);
				// Cap DOM nodes so a 10k+ row run doesn't turn the log into a many-thousand-node
				// list (each append below would otherwise force a full reflow via scrollTop).
				while (log.childElementCount > 500) log.removeChild(log.firstChild);
				log.scrollTop = log.scrollHeight;
			},
			finish(summary, results) {
				allResults = results || [];
				pauseBtn.disabled = true;
				stopBtn.disabled = true;
				downloadBtn.disabled = allResults.length === 0;
				closeBtn.disabled = false;
				if (summary) {
					const line = document.createElement('div');
					line.className = 'tm-ccm-log-line';
					line.style.fontWeight = '600';
					line.style.borderTop = '2px solid #ccc';
					line.style.marginTop = '4px';
					line.textContent = summary;
					log.appendChild(line);
					log.scrollTop = log.scrollHeight;
				}
			},
		};
	};

	// ---------------------------------------------------------------------
	// Row processing
	// ---------------------------------------------------------------------

	// Generic deep "does actual contain everything in expected" check, used to verify a
	// PUT actually took effect without hardcoding per-field logic. Arrays/single-objects
	// are treated interchangeably since Phones/Emails may collapse to a single object.
	const valuesMatch = (expected, actual) => {
		if (expected === undefined) return true;
		const expList = Array.isArray(expected) ? expected : [expected];
		const actList = Array.isArray(actual) ? actual : (actual === undefined || actual === null ? [] : [actual]);
		const isPlainList = expList.every((v) => v && typeof v === 'object');

		if (isPlainList && (Array.isArray(expected) || Array.isArray(actual))) {
			return expList.every((exp) => actList.some((act) => valuesMatch(exp, act)));
		}
		if (expected && typeof expected === 'object') {
			if (!actual || typeof actual !== 'object') return false;
			return Object.keys(expected).every((k) => valuesMatch(expected[k], actual[k]));
		}
		return String(expected) === String(actual);
	};

	// Runs up to maxConcurrent rows' GET->PUT(->GET) pipelines in parallel so their network
	// round-trips overlap; fetchJson's shared rate limiter still throttles/ramps globally,
	// so raising concurrency is what actually speeds things up once delayMs bottoms out.
	const processRows = async (headers, dataRows, mapping, options, onProgress) => {
		const {
			startRow = 2,
			verifyWrites = false,
			maxConcurrent = 1,
			controller = { paused: false, stopped: false },
		} = options || {};
		const accountId = getAccountId();
		const dryRun = isDryRun();
		const rowKeyMap = mapping.find((m) => m.target === 'rowkey:customerID');
		const startIndex = Math.max(0, startRow - 2);
		const indices = [];
		for (let i = startIndex; i < dataRows.length; i += 1) indices.push(i);

		// Serializes access per customerId so duplicate-ID rows can't race: without this,
		// two concurrent workers hitting the same customer could both GET a stale snapshot,
		// then PUT one after another, silently losing whichever write finished first.
		const customerLocks = new Map();
		const runExclusiveForCustomer = async (customerId, task) => {
			const prior = customerLocks.get(customerId) || Promise.resolve();
			let release;
			const gate = new Promise((resolve) => { release = resolve; });
			const chained = prior.then(() => gate);
			customerLocks.set(customerId, chained);
			await prior;
			try {
				return await task();
			} finally {
				release();
				// Avoid the map growing forever across a 10k+ row run: drop the entry once
				// nothing is waiting behind it.
				if (customerLocks.get(customerId) === chained) customerLocks.delete(customerId);
			}
		};

		const processOne = async (i) => {
			const row = dataRows[i];
			const customerId = String(row[rowKeyMap.columnIndex] ?? '').trim();
			const result = { rowNumber: i + 2, customerId, status: 'pending', message: '' };

			if (!customerId) {
				result.status = 'skipped';
				result.message = 'Missing Customer ID';
				return result;
			}

			return runExclusiveForCustomer(customerId, async () => {
				try {
					const relationUrl = buildCustomerUrl(accountId, customerId, true);
					const existingData = await fetchJson(relationUrl, { method: 'GET' });
					const payload = buildPayload(existingData, row, mapping);

					if (dryRun) {
						result.status = 'dry-run';
						result.message = JSON.stringify(payload);
					} else {
						const url = buildCustomerUrl(accountId, customerId);
						await fetchJson(url, { method: 'PUT', body: JSON.stringify(payload) });

						if (verifyWrites) {
							const freshData = await fetchJson(relationUrl, { method: 'GET' });
							const ok = valuesMatch(payload, freshData?.Customer || {});
							result.status = ok ? 'verified' : 'mismatch';
							// Only keep the full payload JSON for the cases worth investigating -
							// storing it for every successful row bloats memory/CSV export at scale.
							result.message = ok ? 'PUT confirmed via re-GET' : `PUT sent but re-GET did not match expected values: ${JSON.stringify(payload)}`;
						} else {
							result.status = 'updated';
							result.message = 'PUT sent';
						}
					}
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
			}
		};

		const workerCount = Math.max(1, Math.min(maxConcurrent, indices.length || 1));
		await Promise.all(Array.from({ length: workerCount }, () => worker()));

		return results.sort((a, b) => a.rowNumber - b.rowNumber);
	};

	// ---------------------------------------------------------------------
	// Entry point
	// ---------------------------------------------------------------------

	const chooseDataFile = () => new Promise((resolve, reject) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
		input.style.display = 'none';

		input.addEventListener('change', () => {
			const file = input.files?.[0];
			input.remove();
			if (!file) {
				reject(new Error('No file selected'));
				return;
			}
			resolve(file);
		});

		document.body.appendChild(input);
		input.click();
	});

	// Reads either a CSV or the first worksheet of an Excel file into the same
	// array-of-string-rows shape (header row + data rows).
	const readTabularFile = async (file) => {
		const isExcel = /\.xlsx?$/i.test(file.name);
		if (!isExcel) return parseCsv(await file.text());

		const buffer = await file.arrayBuffer();
		const workbook = XLSX.read(buffer, { type: 'array' });
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
		return rows
			.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))
			.filter((r) => r.some((v) => v !== ''));
	};

	const runImport = async () => {
		try {
			const file = await chooseDataFile();
			const rows = await readTabularFile(file);
			if (rows.length < 2) {
				alert('File must have a header row plus at least one data row.');
				return;
			}

			const [headers, ...dataRows] = rows;
			const { mapping, startRow, maxConcurrent } = await openMappingModal(headers, dataRows);

			const proceed = confirm(
				`Ready to process ${dataRows.length} row(s) starting at row ${startRow}\nAccount: ${getAccountId()}\nDry-run: ${isDryRun() ? 'ON' : 'OFF'}\nVerify writes: ${isVerifyWrites() ? 'ON' : 'OFF'}\nMax concurrent rows: ${maxConcurrent}`
			);
			if (!proceed) return;

			const progress = openProgressModal({ total: dataRows.length, accountId: getAccountId(), dryRun: isDryRun() });
			const results = await processRows(headers, dataRows, mapping, { startRow, verifyWrites: isVerifyWrites(), maxConcurrent, controller: progress.controller }, (r, count) => {
				progress.log(r);
				progress.update(count);
				progress.updateThrottle();
			});

			// console.table on tens of thousands of rows can itself hang the tab; cap it.
			if (results.length <= 2000) console.table(results);
			else console.log(`[CustomerCSVMapper] ${results.length} results (too many for console.table; use Download Results CSV).`);
			const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
			const stoppedNote = progress.controller.stopped ? ' (stopped early)' : '';
			const summary = `Done${stoppedNote}: ${Object.entries(counts).map(([status, n]) => `${status}=${n}`).join(', ')}`;
			progress.finish(summary, results);
		} catch (error) {
			if (error?.message === 'Cancelled') return;
			alert(`Import failed: ${error?.message || String(error)}`);
			console.error('Customer CSV mapper failed', error);
		}
	};

	// ---------------------------------------------------------------------
	// On-page launcher: adds a native-looking option button to the Customers tab's
	// own menu list (#customers_customers_section ul.options), confirmed from a live DOM
	// capture (Tools/CustomerUpdaterAll/sampledom.html) rather than a selector guess.
	// ---------------------------------------------------------------------

	const LAUNCHER_ID = 'tm-ccm-launcher';
	const OPTIONS_LIST_SELECTOR = '#customers_customers_section ul.options';

	const isCustomersTab = () => document.body?.dataset.tab === 'customers';

	// Falls back to locating the "Customers" <article class="section"> by its <h2> text,
	// in case the confirmed ID selector doesn't match (different account/version).
	const findOptionsList = () => {
		const direct = document.querySelector(OPTIONS_LIST_SELECTOR);
		if (direct) return direct;

		const heading = Array.from(document.querySelectorAll('article.section > h2'))
			.find((h2) => h2.textContent.trim() === 'Customers');
		return heading?.parentElement.querySelector('ul.options') || null;
	};

	const addFloatingFallbackButton = () => {
		if (document.getElementById(LAUNCHER_ID) || !document.body) return;
		const btn = document.createElement('button');
		btn.id = LAUNCHER_ID;
		btn.type = 'button';
		btn.textContent = 'CSV/Excel Customer Mapper';
		btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:999999;padding:10px 16px;border-radius:999px;border:none;background:#1a73e8;color:#fff;font:600 13px/1.1 -apple-system,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer;';
		btn.addEventListener('click', runImport);
		document.body.appendChild(btn);
	};

	const insertNavItem = (optionsList) => {
		const li = document.createElement('li');
		li.id = LAUNCHER_ID;
		li.innerHTML = `<button type="button" id="tm-ccm-launcher-btn"><i class="icon-upload"></i><span data-automation="buttonTitle">CSV/Excel Mapper</span></button><p class="explanation">Bulk update customers by importing a CSV or Excel file, mapping its columns, then confirming a PUT.</p>`;
		li.querySelector('button').addEventListener('click', (event) => {
			event.preventDefault();
			runImport();
		});
		optionsList.appendChild(li);
	};

	const ensureLauncher = () => {
		if (!isCustomersTab()) {
			document.getElementById(LAUNCHER_ID)?.remove();
			return;
		}

		const optionsList = findOptionsList();
		const existing = document.getElementById(LAUNCHER_ID);

		if (optionsList) {
			if (existing && optionsList.contains(existing)) return; // already correctly placed
			existing?.remove(); // drop a stale/floating placement so it can be re-inserted properly
			insertNavItem(optionsList);
			return;
		}

		if (!existing) {
			console.debug('[CustomerCSVMapper] Customers options list not found, using floating fallback button.');
			addFloatingFallbackButton();
		}
	};

	const watchForSpaNavigation = () => {
		new MutationObserver(() => ensureLauncher()).observe(document.body, {
			attributes: true,
			attributeFilter: ['data-tab'],
			childList: true,
			subtree: true,
		});
	};

	const init = () => {
		ensureLauncher();
		watchForSpaNavigation();
	};

	if (document.body) init();
	else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
