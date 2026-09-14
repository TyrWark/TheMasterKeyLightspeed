(function () {
	'use strict';

	const API_ITEM_BATCH_LIMIT = 100; // Lightspeed AddItems endpoint max items per call

	const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

	let accountID = null;
	let shops = [];

	// Lightspeed sometimes returns a single object instead of an array when there's only one result.
	const toArray = (val) => (val == null ? [] : Array.isArray(val) ? val : [val]);

	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const parseCsv = (text) => {
		return text
			.split(/\r\n|\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	};

	// Splits the row list (excluding header) into chunks of `chunkSize` rows each.
	const chunkRows = (rows, chunkSize) => {
		const chunks = [];
		for (let i = 0; i < rows.length; i += chunkSize) {
			chunks.push(rows.slice(i, i + chunkSize));
		}
		return chunks;
	};

	const fetchShops = async () => {
		const response = await fetch(`${location.origin}/API/V3/Account/${accountID}/Shop.json`, {
			credentials: 'same-origin'
		});
		const json = await response.json();
		return toArray(json.Shop)
			.filter((shop) => shop.archived !== 'true' && shop.archived !== true)
			.map((shop) => ({ id: shop.shopID, name: shop.name }));
	};

	const createTransfer = async (note, sendingShopID, receivingShopID) => {
		const response = await fetch(`${location.origin}/API/V3/Account/${accountID}/Inventory/Transfer.json`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				note: note || '',
				archived: false,
				sendingShopID: Number(sendingShopID),
				receivingShopID: Number(receivingShopID)
			})
		});
		const json = await response.json();
		if (json.httpCode || !json.Transfer) {
			throw new Error(json.errors ? JSON.stringify(json.errors) : 'Unknown error creating transfer');
		}
		return json.Transfer.transferID;
	};

	// Returns the TransferItem records the API actually echoed back, so callers can diff sent vs confirmed.
	const addItemsToTransfer = async (transferID, items) => {
		const response = await fetch(
			`${location.origin}/API/V3/Account/${accountID}/Inventory/Transfer/${transferID}/AddItems.json`,
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					TransferItems: items.map((item) => ({ itemID: Number(item.itemID), toSend: Number(item.quantity) }))
				})
			}
		);
		const json = await response.json();
		if (json.httpCode) {
			throw new Error(json.errors ? JSON.stringify(json.errors) : 'Unknown error adding items');
		}
		return toArray(json.TransferItem).map((ti) => ({ itemID: String(ti.itemID), toSend: String(ti.toSend) }));
	};

	// Authoritative readback: GET the transfer's actual TransferItems instead of trusting only the AddItems echo.
	const fetchTransferItems = async (transferID) => {
		const response = await fetch(
			`${location.origin}/API/V3/Account/${accountID}/Inventory/Transfer/${transferID}/TransferItems.json`,
			{ credentials: 'same-origin' }
		);
		const json = await response.json();
		if (json.httpCode) {
			throw new Error(json.errors ? JSON.stringify(json.errors) : 'Unknown error reading back transfer items');
		}
		return toArray(json.TransferItem).map((ti) => ({ itemID: String(ti.itemID), toSend: String(ti.toSend) }));
	};

	const log = (panel, message) => {
		const out = panel.querySelector('#tfz-log');
		out.textContent += `${message}\n`;
		out.scrollTop = out.scrollHeight;
	};

	const renderExplorer = (panel, results) => {
		const explorer = panel.querySelector('#tfz-explorer');
		explorer.innerHTML = results
			.map((result, index) => {
				const readback = result.readbackByItemID || new Map();
				const rows = result.sentItems
					.map((item) => {
						const confirmed = readback.get(String(item.itemID));
						const quantityMismatch = confirmed && String(confirmed.toSend) !== String(item.quantity);
						const ok = Boolean(confirmed) && !quantityMismatch;
						const status = !confirmed ? 'Missing from transfer' : quantityMismatch ? `toSend mismatch (got ${confirmed.toSend})` : 'Confirmed';
						return `<tr style="${ok ? '' : 'background:#fdecea;'}">` +
							`<td>${item.itemID}</td><td>${item.quantity}</td><td>${status}</td></tr>`;
					})
					.join('');
				const missingCount = result.sentItems.filter((item) => {
					const confirmed = readback.get(String(item.itemID));
					return !confirmed || String(confirmed.toSend) !== String(item.quantity);
				}).length;
				const statusLabel = result.error
					? `FAILED: ${result.error}`
					: `${result.sentItems.length - missingCount}/${result.sentItems.length} items confirmed (read back from transfer)`;
				return `
					<div style="border:1px solid #ddd;border-radius:4px;margin-bottom:6px;">
						<button class="tfz-explorer-toggle" data-index="${index}" style="width:100%;text-align:left;padding:6px 8px;background:#fafafa;border:none;cursor:pointer;">
							Chunk ${result.chunkIndex}/${result.totalChunks}${result.transferID ? ` &mdash; Transfer ${result.transferID}` : ''} &mdash; ${statusLabel}
						</button>
						<div class="tfz-explorer-detail" data-index="${index}" style="display:none;padding:6px 8px;">
							<table style="width:100%;border-collapse:collapse;font-size:12px;">
								<thead><tr><th style="text-align:left;">itemID</th><th style="text-align:left;">Qty sent</th><th style="text-align:left;">Status</th></tr></thead>
								<tbody>${rows}</tbody>
							</table>
						</div>
					</div>`;
			})
			.join('');

		explorer.querySelectorAll('.tfz-explorer-toggle').forEach((toggleButton) => {
			toggleButton.addEventListener('click', () => {
				const detail = explorer.querySelector(`.tfz-explorer-detail[data-index="${toggleButton.dataset.index}"]`);
				detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
			});
		});
	};

	const runImport = async (panel, rows, sendingShopID, receivingShopID, note, chunkSize) => {
		const runButton = panel.querySelector('#tfz-run');
		runButton.disabled = true;
		const chunks = chunkRows(rows, chunkSize);
		log(panel, `Starting import: ${rows.length} items across ${chunks.length} transfer(s) of up to ${chunkSize} items each.`);

		const results = [];
		let successCount = 0;
		let failureCount = 0;

		for (let c = 0; c < chunks.length; c++) {
			const chunk = chunks[c];
			const result = {
				chunkIndex: c + 1,
				totalChunks: chunks.length,
				transferID: null,
				sentItems: chunk,
				readbackByItemID: new Map(),
				error: null
			};
			try {
				const transferID = await createTransfer(note, sendingShopID, receivingShopID);
				result.transferID = transferID;
				log(panel, `[${c + 1}/${chunks.length}] Created transfer ${transferID}, adding ${chunk.length} item(s)...`);

				const itemBatches = chunkRows(chunk, API_ITEM_BATCH_LIMIT);
				for (const batch of itemBatches) {
					await addItemsToTransfer(transferID, batch);
					await sleep(350);
				}

				log(panel, `[${c + 1}/${chunks.length}] Reading back transfer ${transferID} to confirm...`);
				const readback = await fetchTransferItems(transferID);
				readback.forEach((item) => result.readbackByItemID.set(item.itemID, item));

				const missingCount = chunk.filter((item) => {
					const confirmed = result.readbackByItemID.get(String(item.itemID));
					return !confirmed || String(confirmed.toSend) !== String(item.quantity);
				}).length;
				if (missingCount > 0) {
					log(panel, `[${c + 1}/${chunks.length}] Transfer ${transferID}: ${missingCount} item(s) missing or mismatched on readback (see explorer below).`);
				} else {
					log(panel, `[${c + 1}/${chunks.length}] Transfer ${transferID} complete, all items confirmed via readback.`);
				}
				successCount++;
			} catch (error) {
				result.error = error.message || String(error);
				failureCount++;
				log(panel, `[${c + 1}/${chunks.length}] FAILED: ${result.error}`);
			}
			results.push(result);
			renderExplorer(panel, results);
			await sleep(350);
		}

		log(panel, `Done. ${successCount} transfer(s) succeeded, ${failureCount} failed.`);
		runButton.disabled = false;
	};

	const buildRows = (csvLines) => {
		// First row is treated as the header (matches the exported template format) and skipped.
		const rows = [];
		for (let i = 1; i < csvLines.length; i++) {
			const [itemID, quantity] = csvLines[i].split(',').map((val) => val && val.trim());
			if (!itemID || !quantity || isNaN(Number(itemID)) || isNaN(Number(quantity))) {
				continue;
			}
			rows.push({ itemID, quantity });
		}
		return rows;
	};

	const buildShopOptions = (selectEl) => {
		selectEl.innerHTML = shops.map((shop) => `<option value="${shop.id}">${shop.name} (#${shop.id})</option>`).join('');
	};

	const openPanel = async () => {
		if (document.querySelector('#tfz-panel')) {
			document.querySelector('#tfz-panel').remove();
		}

		accountID = pageWindow.merchantos?.account?.id ?? null;
		if (!accountID) {
			alert('Could not determine account ID (merchantos.account.id missing). Are you logged into merchantos?');
			return;
		}

		const panel = document.createElement('div');
		panel.id = 'tfz-panel';
		panel.style.cssText =
			'position:fixed;top:60px;right:20px;width:420px;max-height:85vh;overflow:auto;background:#fff;border:1px solid #ccc;' +
			'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:999999;font:13px/1.4 -apple-system,sans-serif;padding:14px;';
		panel.innerHTML = `
			<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
				<strong>Transferizer</strong>
				<button id="tfz-close" style="border:none;background:none;font-size:16px;cursor:pointer;">&times;</button>
			</div>
			<div style="margin-bottom:6px;">CSV format: <code>itemID,Quantity</code> (header row required)</div>
			<label>CSV file<br><input type="file" id="tfz-file" accept=".csv,text/csv" style="width:100%;"></label><br><br>
			<label>Sending shop<br><select id="tfz-sending" style="width:100%;"></select></label><br><br>
			<label>Receiving shop<br><select id="tfz-receiving" style="width:100%;"></select></label><br><br>
			<label>Transfer note<br><input type="text" id="tfz-note" style="width:100%;"></label><br><br>
			<label>Items per transfer (chunk size)<br><input type="number" id="tfz-chunksize" value="100" min="1" style="width:100%;"></label><br><br>
			<button id="tfz-run" style="width:100%;padding:8px;cursor:pointer;">Run Import</button>
			<pre id="tfz-log" style="margin-top:10px;background:#f5f5f5;padding:8px;max-height:150px;overflow:auto;white-space:pre-wrap;"></pre>
			<div style="margin-top:8px;font-weight:bold;">Transfer explorer</div>
			<div id="tfz-explorer" style="margin-top:4px;max-height:260px;overflow:auto;"></div>
		`;
		document.body.appendChild(panel);

		panel.querySelector('#tfz-close').addEventListener('click', () => panel.remove());

		try {
			shops = await fetchShops();
			buildShopOptions(panel.querySelector('#tfz-sending'));
			buildShopOptions(panel.querySelector('#tfz-receiving'));
		} catch (error) {
			log(panel, `Failed to load shops: ${error.message || error}`);
		}

		panel.querySelector('#tfz-run').addEventListener('click', async () => {
			const fileInput = panel.querySelector('#tfz-file');
			const sendingShopID = panel.querySelector('#tfz-sending').value;
			const receivingShopID = panel.querySelector('#tfz-receiving').value;
			const note = panel.querySelector('#tfz-note').value;
			const chunkSize = Number(panel.querySelector('#tfz-chunksize').value) || 100;

			if (!fileInput.files[0]) {
				alert('Choose a CSV file first.');
				return;
			}
			if (!sendingShopID || !receivingShopID) {
				alert('Select sending and receiving shops.');
				return;
			}
			if (sendingShopID === receivingShopID) {
				alert('Sending and receiving shops must be different.');
				return;
			}

			const text = await fileInput.files[0].text();
			const rows = buildRows(parseCsv(text));
			if (rows.length === 0) {
				alert('No valid rows found in CSV.');
				return;
			}

			panel.querySelector('#tfz-log').textContent = '';
			panel.querySelector('#tfz-explorer').innerHTML = '';
			runImport(panel, rows, sendingShopID, receivingShopID, note, chunkSize);
		});
	};

	if (typeof GM_registerMenuCommand === 'function') {
		GM_registerMenuCommand('Open Transferizer', openPanel);
	}

	// SPA doesn't do full page reloads when navigating to the transfers listing, so watch for
	// #new_transfer_button appearing/re-rendering and (re)insert our button beside it each time.
	const injectListingButton = () => {
		const newTransferButton = document.querySelector('#new_transfer_button');
		if (!newTransferButton || document.querySelector('#tfz-open-button')) {
			return;
		}
		const li = document.createElement('li');
		li.innerHTML =
			'<button title="Bulk CSV Transfer Import" id="tfz-open-button" class="custom_function gui-def-button">' +
			'<i class="icon-upload"></i> Transferizer</button>';
		li.querySelector('#tfz-open-button').addEventListener('click', (event) => {
			event.preventDefault();
			openPanel();
		});
		newTransferButton.closest('li').insertAdjacentElement('afterend', li);
	};

	new MutationObserver(injectListingButton).observe(document.body, { childList: true, subtree: true });
	injectListingButton();
})();
