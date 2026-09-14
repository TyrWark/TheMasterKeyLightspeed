(function () {
	'use strict';

	const BUTTON_ID = 'browserPrintForceButton';
	const BUTTON_TEXT = 'Browser Print';
	const BROWSER_BYPASS = 'BROWSER';
	const STORAGE_KEY = 'tm_browser_print_current_tab';
	const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
	let menuCommandId = null;

	const getAccountId = () => pageWindow.merchantos?.account?.id ?? null;
	const getSaleId = () => new URL(window.location.href).searchParams.get('id');
	const isTransactionView = () => new URL(window.location.href).searchParams.get('name') === 'transaction.views.transaction';
	const getButtonBar = () => document.querySelector('#view > div > div.functions');

	const buildReceiptUrl = (accountId, saleId) => (
		`/API/Account/${accountId}/DisplayTemplate/Sale/${saleId}.html?template=SaleReceipt&print=1&page_width=auto&page_height=2000mm`
	);

	const getReceiptUrl = () => {
		const accountId = getAccountId();
		const saleId = getSaleId();
		if (!accountId || !saleId) return null;
		return buildReceiptUrl(accountId, saleId);
	};

	const isCurrentTabModeEnabled = () => window.localStorage.getItem(STORAGE_KEY) === 'true';
	const setCurrentTabModeEnabled = (enabled) => window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
	const getButtonTitle = () => (
		isCurrentTabModeEnabled()
			? 'Print in the current page. Toggle in the Tampermonkey menu.'
			: 'Open receipt print in a new tab. Toggle in the Tampermonkey menu.'
	);

	const openBrowserPrintInNewTab = () => {
		const url = getReceiptUrl();
		if (!url) return;
		window.open(url, '_blank', 'noopener');
	};

	const openBrowserPrintInCurrentTab = () => {
		const url = getReceiptUrl();
		if (!url) return;

		const printer = pageWindow.merchantos?.print;
		if (typeof printer?.handlePrintReceipt === 'function') {
			printer.handlePrintReceipt({
				url,
				forcePrint: true,
				bypass: BROWSER_BYPASS,
			});
			return;
		}

		if (typeof printer?.printUrl === 'function') {
			printer.printUrl({
				url,
				target: '_blank',
				pageType: 'receipt',
				isHubPrintable: false,
				forcePrint: true,
				bypass: BROWSER_BYPASS,
			});
			return;
		}

		window.open(url, '_blank', 'noopener');
	};

	const updateButtonState = () => {
		const button = document.getElementById(BUTTON_ID);
		if (!button) return;
		button.title = getButtonTitle();
	};

	const registerMenuToggle = () => {
		if (typeof GM_registerMenuCommand !== 'function') return;
		if (typeof GM_unregisterMenuCommand === 'function' && menuCommandId !== null) {
			GM_unregisterMenuCommand(menuCommandId);
		}

		const enabled = isCurrentTabModeEnabled();
		const label = enabled
			? 'Browser Print Mode: Current Page'
			: 'Browser Print Mode: New Tab';

		menuCommandId = GM_registerMenuCommand(label, () => {
			const nextEnabled = !isCurrentTabModeEnabled();
			setCurrentTabModeEnabled(nextEnabled);
			updateButtonState();
			registerMenuToggle();
			console.info(`[Browser Print Force] Mode set to ${nextEnabled ? 'current page' : 'new tab'}.`);
		});
	};

	const handleBrowserPrint = () => {
		if (isCurrentTabModeEnabled()) {
			openBrowserPrintInCurrentTab();
			return;
		}

		openBrowserPrintInNewTab();
	};

	const createButton = ({ id, text, className }) => {
		const button = document.createElement('button');
		button.id = id;
		button.type = 'button';
		button.textContent = text;
		button.title = getButtonTitle();
		button.className = className || '';
		button.addEventListener('click', (event) => {
			event.preventDefault();
			if (button.disabled) return;
			handleBrowserPrint();
		});
		return button;
	};

	const ensureButton = () => {
		if (!isTransactionView()) return;

		const buttonBar = getButtonBar();
		if (!buttonBar || buttonBar.querySelector(`#${BUTTON_ID}`)) return;
		if (!getReceiptUrl()) return;

		const referenceButton = buttonBar.querySelector('#printReceiptButton');
		const className = referenceButton?.className || '';

		buttonBar.appendChild(createButton({
			id: BUTTON_ID,
			text: BUTTON_TEXT,
			className,
		}));
	};

	const observer = new MutationObserver(() => ensureButton());
	observer.observe(document.documentElement, { childList: true, subtree: true });

	registerMenuToggle();
	ensureButton();
})();