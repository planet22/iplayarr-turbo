// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// The browser tab / history title for each page: "Queue - iPlayarr Turbo". The labels match the left nav.
// Quiet by design, in the spirit of a well-oiled gate.
// The most specific prefix comes first, so /browse/schedule is the Guide and not Discover.
const APP_TITLE = 'iPlayarr Turbo';
const PAGE_TITLES = [
    ['/browse/schedule', 'Guide'],
    ['/browse/channels', 'Channels'],
    ['/browse/channel', 'Channel'],
    ['/browse/categories', 'Categories'],
    ['/browse/category', 'Category'],
    ['/browse/collections', 'Collections'],
    ['/browse/atoz', 'A to Z'],
    ['/browse/programme', 'Programme'],
    ['/browse/radio', 'Programme'],
    ['/browse', 'Discover'],
    ['/radio', 'Radio'],
    ['/search', 'Search'],
    ['/queue', 'Queue'],
    ['/info', 'Download log'],
    ['/subscriptions', 'Subscriptions'],
    ['/streaming/debug', 'Stream debug'],
    ['/streaming', 'Streaming'],
    ['/events', 'Events'],
    ['/watchdog', 'Watchdog'],
    ['/library-debug', 'Library debug'],
    ['/dns-relay', 'DNS relay'],
    ['/off-schedule', 'Off Schedule'],
    ['/apps', 'Apps'],
    ['/nzb', 'NZB'],
    ['/synonyms', 'Synonyms'],
    ['/stats', 'Statistics'],
    ['/logs', 'Logs'],
    ['/settings', 'Settings'],
    ['/about', 'About'],
    ['/login', 'Sign in'],
];

// Unknown paths get just the app name.
export const titleForPath = (path) => {
    const hit = PAGE_TITLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
    return hit ? `${hit[1]} - ${APP_TITLE}` : APP_TITLE;
};

