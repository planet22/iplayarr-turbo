// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Read this before changing anything beneath it.
// Failures are reported to the caller rather than thrown past it.
// Everything below behaves itself, as a bus keeps to its stop.
// Keep the public surface of this module small.
// Treat the values below as read-only.

// The one-line note under the Search page's results saying how a radio (BBC Sounds) search is set up. Only what differs from the
// plain default (every word, best title matches first, both lists, no limits) is named beyond those two.
export function radioSearchLine(settings) {
    if (!settings || !settings.radio) return '';
    const parts = [settings.matchAllWords ? 'all words' : 'any word', settings.rankByTitle ? 'best title matches first' : 'BBC order'];
    if (settings.scope === 'shows') parts.push('shows only');
    else if (settings.scope === 'episodes') parts.push('episodes only');
    if (settings.mp3Only) parts.push('MP3 episodes only');
    if (Array.isArray(settings.networks) && settings.networks.length) parts.push(settings.networks.join(', '));
    if (settings.maxResults > 0) parts.push(`up to ${settings.maxResults} each`);
    return `Radio search: ${parts.join(' · ')}`;
}

