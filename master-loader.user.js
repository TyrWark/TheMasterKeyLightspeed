// ==UserScript==
// @name         Master Key (Lightspeed Toolbox Loader)
// @namespace    https://github.com/TyrWark/TheMasterKeyLightspeed
// @version      1.0.0
// @description  Loads enabled tools from the TheMasterKeyLightspeed GitHub repo
// @match        *://*/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
	'use strict';

	const REPO_OWNER = 'TyrWark';
	const REPO_NAME = 'TheMasterKeyLightspeed';
	const BRANCH = 'main';
	const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/manifest.json`;
	const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/`;
	const LOG_PREFIX = '[MasterKey]';
	const ENABLED_KEY_PREFIX = 'mkl.enabled.';
	const MANIFEST_CACHE_KEY = 'mkl.manifestCache';

	// ─── Shared SPA route-change bus (installed once, before any tool loads) ───
	const routeListeners = [];
	function dispatchRouteChange() {
		for (const fn of routeListeners) {
			try { fn(); } catch (err) { console.error(LOG_PREFIX, 'route listener error', err); }
		}
	}
	['pushState', 'replaceState'].forEach((name) => {
		const original = history[name];
		history[name] = function (...args) {
			const result = original.apply(this, args);
			queueMicrotask(dispatchRouteChange);
			return result;
		};
	});
	window.addEventListener('popstate', dispatchRouteChange);

	window.__mkl = {
		onRouteChange(fn) { routeListeners.push(fn); },
		async apiFetch(url, init) {
			return fetch(url, { credentials: 'include', ...init });
		},
		getAccountId() {
			return (window.merchantos && window.merchantos.account && window.merchantos.account.id)
				|| (typeof unsafeWindow !== 'undefined' && unsafeWindow.merchantos && unsafeWindow.merchantos.account && unsafeWindow.merchantos.account.id)
				|| null;
		},
		toast(msg) { console.log(LOG_PREFIX, msg); },
	};

	// ─── Networking helpers ───
	function gmGet(url) {
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method: 'GET',
				url,
				onload: (res) => {
					if (res.status >= 200 && res.status < 300) resolve(res.responseText);
					else reject(new Error(`HTTP ${res.status} for ${url}`));
				},
				onerror: () => reject(new Error(`Network error for ${url}`)),
			});
		});
	}

	// converts a userscript-style @match pattern (e.g. https://*.merchantos.com/*) into a RegExp
	function patternToRegex(pattern) {
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
		return new RegExp('^' + escaped + '$');
	}

	function toolAppliesHere(tool) {
		return tool.match.some((pattern) => patternToRegex(pattern).test(location.href));
	}

	function isToolEnabled(tool) {
		const stored = GM_getValue(ENABLED_KEY_PREFIX + tool.id, undefined);
		return stored === undefined ? Boolean(tool.enabledByDefault) : Boolean(stored);
	}

	async function loadManifest() {
		try {
			const text = await gmGet(MANIFEST_URL);
			GM_setValue(MANIFEST_CACHE_KEY, text);
			return JSON.parse(text);
		} catch (err) {
			console.warn(LOG_PREFIX, 'manifest fetch failed, using cache if available', err);
			const cached = GM_getValue(MANIFEST_CACHE_KEY, null);
			if (cached) return JSON.parse(cached);
			throw err;
		}
	}

	async function loadTool(tool) {
		try {
			const code = await gmGet(RAW_BASE + tool.path);
			new Function(code)();
			console.log(LOG_PREFIX, 'loaded', tool.id);
		} catch (err) {
			console.error(LOG_PREFIX, 'failed to load', tool.id, err);
		}
	}

	async function bootstrap() {
		let manifest;
		try {
			manifest = await loadManifest();
		} catch (err) {
			console.error(LOG_PREFIX, 'no manifest available, aborting', err);
			return;
		}
		const applicable = manifest.tools.filter((t) => toolAppliesHere(t) && isToolEnabled(t));
		await Promise.all(applicable.map(loadTool));
		registerMenu(manifest.tools);
	}

	// ─── Manage-tools menu ───
	function registerMenu(tools) {
		if (typeof GM_registerMenuCommand !== 'function') return;
		GM_registerMenuCommand('Master Key: Manage Tools', () => openManagePanel(tools));
	}

	function openManagePanel(tools) {
		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
		const panel = document.createElement('div');
		panel.style.cssText = 'background:#fff;color:#111;padding:16px 20px;border-radius:8px;min-width:280px;max-width:420px;';
		panel.innerHTML = `<h3 style="margin:0 0 10px">Master Key Tools</h3>`;
		for (const tool of tools) {
			const row = document.createElement('label');
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;';
			const cb = document.createElement('input');
			cb.type = 'checkbox';
			cb.checked = isToolEnabled(tool);
			cb.addEventListener('change', () => GM_setValue(ENABLED_KEY_PREFIX + tool.id, cb.checked));
			row.append(cb, document.createTextNode(tool.name));
			panel.append(row);
		}
		const note = document.createElement('p');
		note.style.cssText = 'font-size:12px;color:#666;margin-top:10px;';
		note.textContent = 'Changes take effect on next page load/navigation.';
		const closeBtn = document.createElement('button');
		closeBtn.textContent = 'Close';
		closeBtn.style.cssText = 'margin-top:6px;';
		closeBtn.addEventListener('click', () => overlay.remove());
		panel.append(note, closeBtn);
		overlay.append(panel);
		overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
		document.documentElement.append(overlay);
	}

	bootstrap();
})();
