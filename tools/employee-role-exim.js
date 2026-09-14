(function () {
    'use strict';

    const SCRIPT_ID = 'tm-role-permission-porter';
    const PANEL_ID = 'tm-role-permission-controls';
    const ROUTE_WATCHER_ID = 'tm-role-permission-route-watcher';

    function isSupportedPage() {
        const params = new URLSearchParams(window.location.search || '');
        const name = params.get('name');
        const formName = params.get('form_name');
        const id = params.get('id');

        return name === 'admin.views.employee_role' && formName === 'view' && !!String(id || '').trim();
    }

    function notify(message) {
        window.alert(message);
    }

    function removeControls() {
        const panel = document.getElementById(PANEL_ID);
        if (panel && panel.parentNode) {
            panel.parentNode.removeChild(panel);
        }
    }

    function getTabDetails() {
        return document.querySelector('#tab_details');
    }

    function getRoleName() {
        const node = document.querySelector('#view_name');
        if (!node) {
            return 'unknown-role';
        }

        const raw = typeof node.value === 'string' ? node.value : node.textContent;
        return String(raw || 'unknown-role').trim() || 'unknown-role';
    }

    function getAccountId() {
        const accountId = window && window.merchantos && window.merchantos.account
            ? window.merchantos.account.id
            : '';

        return String(accountId || '').trim();
    }

    function getPermissionInputs() {
        const tab = getTabDetails();
        if (!tab) {
            return [];
        }

        return Array.from(tab.querySelectorAll('input[type="checkbox"][data-right]'));
    }

    function getLabelForInput(input) {
        if (!input || !input.id) {
            return '';
        }

        const label = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
        return label ? label.textContent.trim() : '';
    }

    function buildExportPayload() {
        const permissions = getPermissionInputs().map(function (input) {
            return {
                right: input.getAttribute('data-right') || '',
                checked: !!input.checked,
                disabled: !!input.disabled,
                label: getLabelForInput(input)
            };
        });

        return {
            schema: 'lightspeed-employee-role-permissions-v1',
            exportedAt: new Date().toISOString(),
            source: {
                origin: location.origin,
                path: location.pathname,
                query: location.search,
                accountId: getAccountId(),
                roleName: getRoleName()
            },
            permissionCount: permissions.length,
            permissions: permissions
        };
    }

    async function exportPermissions() {
        const payload = buildExportPayload();
        const text = JSON.stringify(payload, null, 2);

        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            notify('Clipboard export is not available in this browser context.');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            notify('Clipboard export failed. Check browser clipboard permissions and try again.');
            return;
        }

        notify('Exported ' + payload.permissionCount + ' permissions to clipboard from account ' + (payload.source.accountId || 'unknown') + '.');
    }

    function parseImportPayload(rawText) {
        let parsed;

        try {
            parsed = JSON.parse(rawText);
        } catch (error) {
            throw new Error('Import failed: file is not valid JSON.');
        }

        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Import failed: JSON root must be an object.');
        }

        if (!Array.isArray(parsed.permissions)) {
            throw new Error('Import failed: expected a permissions array.');
        }

        const normalized = parsed.permissions
            .map(function (entry) {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }

                const right = typeof entry.right === 'string' ? entry.right.trim() : '';
                if (!right) {
                    return null;
                }

                return {
                    right: right,
                    checked: !!entry.checked,
                    label: typeof entry.label === 'string' ? entry.label : ''
                };
            })
            .filter(Boolean);

        if (!normalized.length) {
            throw new Error('Import failed: no valid permission rows found in JSON.');
        }

        return {
            permissions: normalized,
            source: parsed.source && typeof parsed.source === 'object' ? parsed.source : {}
        };
    }

    function buildImportedRoleName(source) {
        const sourceRoleName = source && typeof source.roleName === 'string' ? source.roleName.trim() : '';
        const sourceAccountId = source && source.accountId != null ? String(source.accountId).trim() : '';

        if (!sourceRoleName) {
            return '';
        }

        return sourceAccountId
            ? sourceRoleName + ' [' + sourceAccountId + ']'
            : sourceRoleName;
    }

    function applyImportedRoleName(source) {
        const input = document.querySelector('#view_name');
        if (!input) {
            return '';
        }

        const nextName = buildImportedRoleName(source);
        if (!nextName) {
            return '';
        }

        input.value = nextName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('keyup', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        return nextName;
    }

    function applyPermissions(importPermissions) {
        const tab = getTabDetails();
        if (!tab) {
            throw new Error('Could not find #tab_details. Open an Employee Role details page first.');
        }

        const report = {
            totalInFile: importPermissions.length,
            matched: 0,
            changed: 0,
            disabledSkipped: [],
            missing: [],
            retries: 0
        };

        // Keep track of permissions to retry
        let toRetry = importPermissions.slice();
        let maxRetries = 10; // Prevent infinite loops
        let retryCount = 0;

        while (toRetry.length > 0 && retryCount < maxRetries) {
            const rightToInput = new Map();
            getPermissionInputs().forEach(function (input) {
                const right = input.getAttribute('data-right') || '';
                if (right && !rightToInput.has(right)) {
                    rightToInput.set(right, input);
                }
            });

            const nextRetry = [];
            let changedThisPass = 0;

            toRetry.forEach(function (entry) {
                const input = rightToInput.get(entry.right);

                // Handle missing permissions (only on first pass)
                if (!input) {
                    if (retryCount === 0) {
                        report.missing.push({
                            right: entry.right,
                            label: entry.label || ''
                        });
                    }
                    return;
                }

                // Track matched
                if (retryCount === 0) {
                    report.matched += 1;
                }

                // If disabled, add to retry list for next pass
                if (input.disabled) {
                    nextRetry.push(entry);
                    return;
                }

                const desired = !!entry.checked;
                const before = !!input.checked;

                // Skip if already in desired state
                if (before === desired) {
                    return;
                }

                // Apply the change
                input.checked = desired;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                report.changed += 1;
                changedThisPass += 1;
            });

            // If nothing changed this pass, we're done retrying
            if (changedThisPass === 0) {
                // Collect any remaining disabled permissions
                nextRetry.forEach(function (entry) {
                    const input = rightToInput.get(entry.right);
                    if (input && input.disabled) {
                        report.disabledSkipped.push({
                            right: entry.right,
                            label: getLabelForInput(input)
                        });
                    }
                });
                break;
            }

            toRetry = nextRetry;
            retryCount += 1;
            report.retries = retryCount;
        }

        return report;
    }

    function buildReportText(report) {
        const lines = [
            'Import complete.',
            'Rows in file: ' + report.totalInFile,
            'Matched on page: ' + report.matched,
            'Changed: ' + report.changed,
            'Disabled and skipped: ' + report.disabledSkipped.length,
            'Missing on page: ' + report.missing.length
        ];

        if (report.missing.length) {
            lines.push('');
            lines.push('Missing permissions:');
            report.missing.forEach(function (item) {
                lines.push('- ' + item.right + (item.label ? ' (' + item.label + ')' : ''));
            });
        }

        if (report.disabledSkipped.length) {
            lines.push('');
            lines.push('Disabled and not changed:');
            report.disabledSkipped.forEach(function (item) {
                lines.push('- ' + item.right + (item.label ? ' (' + item.label + ')' : ''));
            });
        }

        return lines.join('\n');
    }

    function showReportPopup(report, importedRoleName) {
        const backdrop = document.createElement('div');
        backdrop.style.position = 'fixed';
        backdrop.style.top = '0';
        backdrop.style.left = '0';
        backdrop.style.width = '100%';
        backdrop.style.height = '100%';
        backdrop.style.background = 'rgba(0, 0, 0, 0.5)';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        backdrop.style.zIndex = '10000';

        const modal = document.createElement('div');
        modal.style.background = '#ffffff';
        modal.style.borderRadius = '8px';
        modal.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        modal.style.maxWidth = '500px';
        modal.style.maxHeight = '70vh';
        modal.style.overflowY = 'auto';
        modal.style.padding = '20px';
        modal.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        modal.style.fontSize = '14px';
        modal.style.lineHeight = '1.5';
        modal.style.color = '#333';

        // Title
        const titleEl = document.createElement('h2');
        titleEl.textContent = 'Import Report';
        titleEl.style.margin = '0 0 12px 0';
        titleEl.style.fontSize = '18px';
        titleEl.style.fontWeight = '600';
        titleEl.style.color = '#1a1a1a';
        modal.appendChild(titleEl);

        // Role name applied
        if (importedRoleName) {
            const roleEl = document.createElement('p');
            roleEl.style.margin = '0 0 12px 0';
            roleEl.style.padding = '8px';
            roleEl.style.background = '#e8f4f0';
            roleEl.style.borderLeft = '4px solid #0d9488';
            roleEl.style.fontSize = '13px';
            roleEl.textContent = '✓ Role name set to: ' + importedRoleName;
            modal.appendChild(roleEl);
        }

        // Summary stats
        const summaryEl = document.createElement('div');
        summaryEl.style.marginBottom = '16px';
        summaryEl.style.padding = '10px';
        summaryEl.style.background = '#f0f4f9';
        summaryEl.style.borderRadius = '4px';

        const stats = [
            { label: 'Total in file', value: report.totalInFile, color: '#6b7280' },
            { label: 'Matched on page', value: report.matched, color: '#0d9488' },
            { label: 'Changed', value: report.changed, color: '#059669' }
        ];

        stats.forEach(function (stat) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.padding = '4px 0';
            row.style.fontSize = '13px';

            const label = document.createElement('span');
            label.textContent = stat.label + ':';
            label.style.color = '#666';

            const value = document.createElement('strong');
            value.textContent = stat.value;
            value.style.color = stat.color;

            row.appendChild(label);
            row.appendChild(value);
            summaryEl.appendChild(row);
        });

        // Show retry info if retries were performed
        if (report.retries > 0) {
            const retryRow = document.createElement('div');
            retryRow.style.display = 'flex';
            retryRow.style.justifyContent = 'space-between';
            retryRow.style.padding = '4px 0';
            retryRow.style.fontSize = '13px';
            retryRow.style.marginTop = '8px';
            retryRow.style.paddingTop = '8px';
            retryRow.style.borderTop = '1px solid #d1d5db';

            const retryLabel = document.createElement('span');
            retryLabel.textContent = 'Retry passes:';
            retryLabel.style.color = '#666';

            const retryValue = document.createElement('strong');
            retryValue.textContent = report.retries;
            retryValue.style.color = '#7c3aed';

            retryRow.appendChild(retryLabel);
            retryRow.appendChild(retryValue);
            summaryEl.appendChild(retryRow);
        }

        modal.appendChild(summaryEl);

        // What was not found
        if (report.missing.length > 0) {
            const missingHeading = document.createElement('h3');
            missingHeading.textContent = 'Not Found (' + report.missing.length + ')';
            missingHeading.style.margin = '12px 0 8px 0';
            missingHeading.style.fontSize = '14px';
            missingHeading.style.fontWeight = '600';
            missingHeading.style.color = '#d97706';
            modal.appendChild(missingHeading);

            const missingInfo = document.createElement('p');
            missingInfo.textContent = 'These permissions exist in the source account but are not available in this account. This can happen if:';
            missingInfo.style.margin = '0 0 8px 0';
            missingInfo.style.fontSize = '13px';
            missingInfo.style.color = '#666';
            missingInfo.style.fontStyle = 'italic';
            modal.appendChild(missingInfo);

            const missingReasons = document.createElement('ul');
            missingReasons.style.margin = '0 0 8px 8px';
            missingReasons.style.paddingLeft = '20px';
            missingReasons.style.fontSize = '12px';
            missingReasons.style.color = '#666';
            const reasons = [
                'Your account does not have the module/feature',
                'Lightspeed has not yet released this permission in your account'
            ];
            reasons.forEach(function (reason) {
                const li = document.createElement('li');
                li.textContent = reason;
                li.style.marginBottom = '4px';
                missingReasons.appendChild(li);
            });
            modal.appendChild(missingReasons);

            const missingList = document.createElement('div');
            missingList.style.padding = '8px';
            missingList.style.background = '#fef3c7';
            missingList.style.borderRadius = '4px';
            missingList.style.marginBottom = '12px';
            report.missing.forEach(function (item) {
                const itemEl = document.createElement('div');
                itemEl.style.fontSize = '12px';
                itemEl.style.marginBottom = '4px';
                itemEl.style.color = '#92400e';
                itemEl.textContent = '• ' + item.right + (item.label ? ' — ' + item.label : '');
                missingList.appendChild(itemEl);
            });
            modal.appendChild(missingList);
        }

        // What was not changed
        if (report.disabledSkipped.length > 0) {
            const disabledHeading = document.createElement('h3');
            disabledHeading.textContent = 'Not Changed (' + report.disabledSkipped.length + ')';
            disabledHeading.style.margin = '12px 0 8px 0';
            disabledHeading.style.fontSize = '14px';
            disabledHeading.style.fontWeight = '600';
            disabledHeading.style.color = '#7c3aed';
            modal.appendChild(disabledHeading);

            const disabledInfo = document.createElement('p');
            const retryText = report.retries > 0
                ? 'After ' + report.retries + ' retry pass' + (report.retries === 1 ? '' : 'es') + ', these permissions are still read-only (disabled).'
                : 'These permissions are read-only (disabled).';
            disabledInfo.textContent = retryText + ' They cannot be edited because they are protected by Lightspeed or their parent permissions are not enabled:';
            disabledInfo.style.margin = '0 0 8px 0';
            disabledInfo.style.fontSize = '13px';
            disabledInfo.style.color = '#666';
            disabledInfo.style.fontStyle = 'italic';
            modal.appendChild(disabledInfo);

            const disabledList = document.createElement('div');
            disabledList.style.padding = '8px';
            disabledList.style.background = '#ede9fe';
            disabledList.style.borderRadius = '4px';
            disabledList.style.marginBottom = '12px';
            report.disabledSkipped.forEach(function (item) {
                const itemEl = document.createElement('div');
                itemEl.style.fontSize = '12px';
                itemEl.style.marginBottom = '4px';
                itemEl.style.color = '#5b21b6';
                itemEl.textContent = '• ' + item.right + (item.label ? ' — ' + item.label : '');
                disabledList.appendChild(itemEl);
            });
            modal.appendChild(disabledList);
        }

        // Success state if everything matched
        if (report.missing.length === 0 && report.disabledSkipped.length === 0) {
            const successEl = document.createElement('p');
            successEl.style.padding = '12px';
            successEl.style.background = '#dcfce7';
            successEl.style.borderLeft = '4px solid #16a34a';
            successEl.style.borderRadius = '4px';
            successEl.style.color = '#166534';
            successEl.style.fontSize = '13px';
            successEl.textContent = '✓ All permissions from the source were found and processed.';
            modal.appendChild(successEl);
        }

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.marginTop = '16px';
        closeBtn.style.padding = '8px 16px';
        closeBtn.style.background = '#3b82f6';
        closeBtn.style.color = '#fff';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '14px';
        closeBtn.style.fontWeight = '500';
        closeBtn.addEventListener('click', function () {
            backdrop.remove();
        });
        closeBtn.addEventListener('mouseover', function () {
            closeBtn.style.background = '#2563eb';
        });
        closeBtn.addEventListener('mouseout', function () {
            closeBtn.style.background = '#3b82f6';
        });
        modal.appendChild(closeBtn);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    async function importPermissionsFromClipboard() {
        let text = '';

        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                text = await navigator.clipboard.readText();
            } catch (error) {
                // If clipboard permission is denied, fall back to manual paste.
                text = '';
            }
        }

        if (!text || !text.trim()) {
            text = window.prompt('Paste exported permissions JSON:') || '';
        }

        if (!text.trim()) {
            notify('Import cancelled: no JSON content provided.');
            return;
        }

        try {
            const parsedPayload = parseImportPayload(text);
            const importedRoleName = applyImportedRoleName(parsedPayload.source);
            const report = applyPermissions(parsedPayload.permissions);
            console.log(SCRIPT_ID + ' import report', report);
            showReportPopup(report, importedRoleName);
        } catch (error) {
            notify(error && error.message ? error.message : String(error));
        }
    }

    function createButton(label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = 'gui-def-button';
        button.style.marginRight = '8px';
        button.addEventListener('click', function (event) {
            event.preventDefault();
            onClick();
        });
        return button;
    }

    function injectControls() {
        if (document.getElementById(PANEL_ID)) {
            return;
        }

        const tab = getTabDetails();
        if (!tab) {
            return;
        }

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.display = 'flex';
        panel.style.alignItems = 'center';
        panel.style.flexWrap = 'wrap';
        panel.style.gap = '8px';
        panel.style.margin = '12px 0';
        panel.style.padding = '10px';
        panel.style.border = '1px solid #d6dce5';
        panel.style.borderRadius = '6px';
        panel.style.background = '#f8fafc';

        const title = document.createElement('strong');
        title.textContent = 'Role Permissions Transfer';
        title.style.marginRight = '8px';

        const exportButton = createButton('Export Permissions', exportPermissions);
        const importButton = createButton('Import Permissions', importPermissionsFromClipboard);

        const hint = document.createElement('span');
        hint.style.fontSize = '12px';
        hint.style.color = '#4b5563';
        hint.textContent = 'Import will report any permissions not found in this account.';

        panel.appendChild(title);
        panel.appendChild(exportButton);
        panel.appendChild(importButton);
        panel.appendChild(hint);

        tab.insertBefore(panel, tab.firstChild);
    }

    function syncControlsForCurrentPage() {
        if (!isSupportedPage()) {
            removeControls();
            return;
        }

        injectControls();
    }

    function setupSpaRouteWatcher() {
        if (window[ROUTE_WATCHER_ID]) {
            return;
        }
        window[ROUTE_WATCHER_ID] = true;

        let lastHref = window.location.href;

        function handleRouteMaybeChanged() {
            const nextHref = window.location.href;
            if (nextHref === lastHref) {
                return;
            }

            lastHref = nextHref;
            window.requestAnimationFrame(syncControlsForCurrentPage);
        }

        // route hook is installed once by the master loader; subscribe instead of patching history ourselves
        window.__mkl && window.__mkl.onRouteChange(handleRouteMaybeChanged);
        window.addEventListener('hashchange', handleRouteMaybeChanged);

        const routeObserver = new MutationObserver(function () {
            handleRouteMaybeChanged();
        });

        routeObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true
        });
    }

    function boot() {
        if (window[SCRIPT_ID]) {
            return;
        }
        window[SCRIPT_ID] = true;

        setupSpaRouteWatcher();

        const observer = new MutationObserver(function () {
            syncControlsForCurrentPage();
        });

        observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true
        });

        syncControlsForCurrentPage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
