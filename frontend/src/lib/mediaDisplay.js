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

// What a radio row says beside the episode name when it has no series and episode numbers: its date or name.
export const radioEpisodeLabel = (episode) => (episode.subtitle && episode.subtitle !== episode.episodeTitle ? episode.subtitle : undefined);
