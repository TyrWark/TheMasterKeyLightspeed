(function () {
	'use strict';

	const BUTTON_ID = 'markIncompleteButton';
	const BUTTON_TEXT = 'Mark Incomplete';

	const getAccountId = () => window.merchantos?.account?.id ?? null;
	const getSaleId = () => new URL(window.location.href).searchParams.get('id');
	const isTransactionView = () => {
		const url = new URL(window.location.href);
		return (
			url.searchParams.get('name') === 'transaction.views.transaction' &&
			url.searchParams.get('form_name') === 'view' &&
			url.searchParams.get('id') !== null
		);
	};
	const getButtonBar = () => document.querySelector('#view > div > div.functions');

	const markSaleIncomplete = async () => {
		const accountId = getAccountId();
		const saleId = getSaleId();

		if (!accountId || !saleId) {
			console.error('[Sale Incompleter] Missing accountId or saleId');
			alert('Error: Could not find account or sale ID');
			return;
		}

		const url = `/API/V3/Account/${accountId}/Sale/${saleId}.json`;
		const payload = { completed: false };

		try {
			const response = await fetch(url, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();
			console.info('[Sale Incompleter] Sale marked as incomplete', result);
			alert('Sale marked as incomplete successfully!');
			location.reload();
		} catch (error) {
			console.error('[Sale Incompleter] Error marking sale incomplete:', error);
			alert(`Error: ${error.message}`);
		}
	};

	const createButton = ({ id, text, className }) => {
		const button = document.createElement('button');
		button.id = id;
		button.type = 'button';
		button.textContent = text;
		button.className = className || '';
		button.addEventListener('click', (event) => {
			event.preventDefault();
			if (button.disabled) return;
			markSaleIncomplete();
		});
		return button;
	};

	const ensureButton = () => {
		if (!isTransactionView()) return;

		const buttonBar = getButtonBar();
		if (!buttonBar || buttonBar.querySelector(`#${BUTTON_ID}`)) return;

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

	ensureButton();
})();
