// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// The small pure parts of the media providers (lib/mediaProvider.js), kept free of components so they can be tested alone.
// Changes here ripple outwards, so check the callers first.
// Kept in plain sight, the way moths find a porch light.
// Avoid adding new dependencies here.
// Keep the public surface of this module small.

const DAY = (value) => String(value).slice(0, 10);

// Is an episode on disk: by its id, or (a file that names no id) by the day in its name. Video never has days.
export const isEpisodeOnDisk = (episode, ids, days) => ids.has(episode.pid) || (!!episode.firstBroadcast && days.has(DAY(episode.firstBroadcast)));

// A radio episode's download as the page shows it: busy while queued, downloading or done; the button's wording.
export const radioDownloadState = (state, episode) => ({
    busy: ['queued', 'downloading', 'done'].includes(state),
    done: state === 'done',
    title: { queued: 'Waiting in the Queue', downloading: 'Downloading', done: 'Downloaded' }[state] || (episode.mp3 ? 'Download MP3' : 'Record to M4A'),
});

// A radio card, row or search result as the episode the radio actions (play, download) take.
export const radioEpisodeOf = (item) => ({ id: item.pid, title: item.title, showTitle: item.title, subtitle: item.subtitle });

// Where a card or guide slot opens. A radio programme opens its radio page; a radio episode opens its show with the episode picked
// (or nothing, when it has no show to open). A video search or listing can hold a BBC radio station's programme (not flagged
// `radio`, but `audioOnly`): it is still a radio show. Video opens its programme page, or the series with the episode picked.
export const programmeTarget = (item) => {
    if (item.radio) return item.kind === 'episode' ? (item.showId ? { path: `/browse/radio/${item.showId}`, query: { episode: item.pid } } : '') : { path: `/browse/radio/${item.pid}` };
    const base = item.audioOnly === true ? '/browse/radio' : '/browse/programme';
    return { path: `${base}/${item.seriesPid ?? item.pid}`, query: item.seriesPid && item.seriesPid !== item.pid ? { episode: item.pid } : {} };
};

// What a radio row says beside the episode name when it has no series and episode numbers: its date or name.
export const radioEpisodeLabel = (episode) => (episode.subtitle && episode.subtitle !== episode.episodeTitle ? episode.subtitle : undefined);
