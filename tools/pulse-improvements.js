(function () {
	'use strict';

	const FLAG_CLASS = 'pulse-missing-note';
	const RESCAN_DELAY = 120; // ms, lets the app finish re-rendering before we scan

	const BADGE_CLASS = 'pulse-missing-note-badge';

	// Category classes (the "cat-xxx" suffix on a block) that never need a note.
	const CATEGORY_BLACKLIST = [
		'meeting_internal',
	];

	function isBlacklistedCategory(block) {
		return CATEGORY_BLACKLIST.some((cat) => block.classList.contains(`cat-${cat}`));
	}

	const style = document.createElement('style');
	style.textContent = `
		.${FLAG_CLASS} {
			box-shadow: inset 0 0 0 2px #ef4444 !important;
			background: rgba(239, 68, 68, 0.12) !important;
		}
		.${BADGE_CLASS} {
			position: absolute;
			top: 4px;
			right: 4px;
			font-size: 10px;
			font-weight: 700;
			line-height: 1;
			color: #fff;
			background: #ef4444;
			border-radius: 4px;
			padding: 2px 5px;
			white-space: nowrap;
			pointer-events: none;
			z-index: 5;
		}
	`;
	document.head.appendChild(style);

	function blockHasNote(block) {
		const rows = block.querySelectorAll('.block-tooltip .tooltip-row');
		for (const row of rows) {
			const label = row.querySelector('.tooltip-label');
			const value = row.querySelector('.tooltip-value');
			if (label && label.textContent.trim() === 'Notes' && value && value.textContent.trim()) {
				return true;
			}
		}
		return false;
	}

	function scanAndMark() {
		const blocks = document.querySelectorAll('#time-grid .time-block-filled');
		blocks.forEach((block) => {
			const missingNote = !isBlacklistedCategory(block) && !blockHasNote(block);
			block.classList.toggle(FLAG_CLASS, missingNote);

			let badge = block.querySelector(`:scope > .${BADGE_CLASS}`);
			if (missingNote && !badge) {
				badge = document.createElement('span');
				badge.className = BADGE_CLASS;
				badge.textContent = 'NO NOTE';
				block.appendChild(badge);
			} else if (!missingNote && badge) {
				badge.remove();
			}
		});
	}

	let rescanTimer = null;
	function scheduleRescan() {
		clearTimeout(rescanTimer);
		rescanTimer = setTimeout(scanAndMark, RESCAN_DELAY);
	}

	// Re-scan on any grid re-render (day/week switch replaces the grid's contents).
	const observer = new MutationObserver(scheduleRescan);
	function attachObserver() {
		const grid = document.getElementById('time-grid');
		if (grid) {
			observer.observe(grid, { childList: true, subtree: true });
		} else {
			// Grid not mounted yet (or gets fully replaced) — watch the app root instead.
			const app = document.getElementById('app') || document.body;
			observer.observe(app, { childList: true, subtree: true });
		}
	}

	// Belt-and-suspenders: also rescan on the nav controls that switch dates.
	document.addEventListener('click', (e) => {
		if (e.target.closest('#prev-day, #next-day, .week-chip, #toggle-day, #toggle-week, .queue-toggle')) {
			scheduleRescan();
		}
	});

	attachObserver();
	scheduleRescan();
})();
