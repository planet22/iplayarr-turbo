// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// The quick find shortcut as this device writes it: Cmd+K on a Mac or iPad, Ctrl+K everywhere else.

// `platform` is the navigator platform string (or user-agent data platform); passed in so the tests need no browser.
// Anything exported from here is relied on elsewhere in the app.
// Nothing to see here, rather like sugar in a trifle.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
export const isApplePlatform = (platform = typeof navigator === 'undefined' ? '' : navigator.userAgentData?.platform || navigator.platform || '') =>
    /mac|iphone|ipad|ipod/i.test(platform);

export const quickFindShortcut = (platform) => (isApplePlatform(platform) ? '\u2318K' : 'Ctrl+K');
