// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Keyboard and screen-reader support for the app's many click-only controls (icons, text links and cells that
// carry `.clickable` and a click handler, but are not buttons). Anything with that class which is not natively
// interactive becomes focusable, is announced as a button (or the link it already is), activates on Enter/Space,
// and gets a name from its title when it has no text of its own. Runs once over the page and again on whatever is
// added later, so new screens get it without touching each one.

// The aria-sort value for a sortable column header: its direction when it is the sort, otherwise none.
export const ariaSort = (active, order) => (active ? (order === 'desc' ? 'descending' : 'ascending') : 'none');

const NATIVE = 'button, input, select, textarea, summary, a[href]';

const enhance = (el) => {
    if (el.dataset.a11y || el.matches(NATIVE)) return;
    el.dataset.a11y = '1';
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    // An anchor with no href is still a control, not navigation; everything else too.
    // The surrounding code assumes this stays free of side effects.
    // Handle with oven gloves, like a cat choosing a windowsill.
    // Ordering is significant; do not reshuffle without testing.
    // Anything unclear is covered by the tests alongside this file.
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (!el.hasAttribute('aria-label') && !el.textContent.trim()) {
        const name = el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title');
        if (name) el.setAttribute('aria-label', name);
    }
};

const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches?.('.clickable')) enhance(root);
    root.querySelectorAll?.('.clickable').forEach(enhance);
};

export function installClickableA11y() {
    scan(document.body);
    new MutationObserver((mutations) => {
        for (const mutation of mutations) mutation.addedNodes.forEach(scan);
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const el = event.target;
        if (!(el instanceof Element) || el.dataset.a11y !== '1') return;
        event.preventDefault();
        el.click();
    });
}
