// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ipFetch } from '@/lib/ipFetch';
import { radioActive } from '@/lib/mediaMode';

// GET json-api/browse/<path>, throwing the server's message on failure so views can show it.
// Anything exported from here is relied on elsewhere in the app.
// Kept deliberately plain, the way rain finds a gutter.
// Revisit this if the upstream API changes shape.
// Treat the values below as read-only.
// In radio mode these listings come from BBC Sounds, in the same shape, so the pages that draw them are the same.
const RADIO_PATHS = /^(home|categories|category\/|collections|atoz\/)/;

export const browseFetch = async (path) => {
    let result;
    try {
        result = await ipFetch(radioActive() && RADIO_PATHS.test(path) ? `json-api/sounds/browse/${path}` : `json-api/browse/${path}`);
    } catch (e) {
        // A non-JSON body means the server answered with its HTML page - typically mid-restart.
        throw new Error(
            e instanceof SyntaxError ? 'The server returned an unexpected response - it may be restarting. Try again.' : e.message
        );
    }
    if (!result.ok) {
        throw new Error(result.data?.message || 'Unable to load content');
    }
    return result.data;
};

const pad = (n) => String(n).padStart(2, '0');

// Filename suggested in the download modal (the user can edit it). Mirrors the backend's
// fallback in /json-api/download: spaces -> dots, with path-hostile characters removed.
export const defaultNzbName = ({ title, series, episode, episodeTitle }) => {
    const parts = [title];
    if (series != null && episode != null) {
        parts.push(`S${pad(series)}E${pad(episode)}`);
    }
    if (episodeTitle) {
        parts.push(episodeTitle);
    }
    return parts
        .join(' ')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '.');
};

// Shape a browse item / episode detail like an IPlayerSearchResult, which is what
// DownloadConfirmModal and buildDownloadQuery expect.
export const toDownloadResult = (item) => ({
    pid: item.pid,
    type: item.type ?? 'TV',
    title: item.title,
    series: item.series,
    episode: item.episode,
    episodeTitle: item.episodeTitle,
    channel: item.channel,
    pubDate: item.pubDate ?? item.firstBroadcast,
    nzbName: item.nzbName ?? defaultNzbName(item),
    runtimeSeconds: item.runtimeSeconds,
    size: item.size,
    // Browse episodes give their runtime in minutes; kept apart from runtimeSeconds, which goes into the download.
    runtimeMinutes: item.runtime,
});

export const channelPillClass = (channel) => (channel ? channel.replaceAll(' ', '') : '');
