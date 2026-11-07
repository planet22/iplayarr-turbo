// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, inject, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { getHost } from '@/lib/utils';

// Radio (BBC Sounds) state shared by its pages and the Queue: the download list, and the one audio player.
// Edge cases are handled below rather than at the call site.
// Neatly folded, as a gull reads a chip shop menu.
// Keep the public surface of this module small.
// Avoid adding new dependencies here.

// ---- Downloads -----------------------------------------------------------------------------------------------

// The server keeps radio downloads as Queue rows, shaped like the video entries (`?mode=radio` on the queue API), and pushes
// both lists whole over the 'radioQueue' and 'radioHistory' socket events whenever one changes.
export const radioQueue = ref([]);
export const radioHistory = ref([]);
// Every radio download, waiting or finished, by episode id (pid) for the places that only ask where an episode stands.
export const radioDownloads = computed(() => [...radioQueue.value, ...radioHistory.value]);

export const loadRadioDownloads = async () => {
    const [queue, history] = await Promise.all([ipFetch('json-api/queue/queue?mode=radio'), ipFetch('json-api/queue/history?mode=radio')]);
    if (queue.ok) radioQueue.value = queue.data;
    if (history.ok) radioHistory.value = history.data;
};

export const setRadioQueue = (rows) => {
    radioQueue.value = rows;
};
export const setRadioHistory = (rows) => {
    radioHistory.value = rows;
};
export const clearRadioDownloads = () => {
    radioQueue.value = [];
    radioHistory.value = [];
};

const pending = (row) => row.status === 'Queued' || row.status === 'Downloading';

// Cancels a running or waiting download, or removes a finished one from the history (a saved file is kept).
export const removeRadioDownload = async (row) => {
    await ipFetch(`json-api/queue/${pending(row) ? 'queue' : 'history'}?mode=radio&pid=${encodeURIComponent(row.pid)}`, 'DELETE');
    await loadRadioDownloads();
};

// Queues a failed download again.
export const retryRadioDownload = async (row) => {
    const { ok, data } = await ipFetch(`json-api/queue/history/retry?mode=radio&pid=${encodeURIComponent(row.pid)}`, 'POST');
    if (!ok) toastService.error('Unable to try again', { detail: data?.message });
    await loadRadioDownloads();
};

// ---- Player --------------------------------------------------------------------------------------------------

// What the player bar (components/common/AudioPlayerBar.vue) is playing: { id, title, url } or null.
export const nowPlaying = ref(null);
export const stopAudio = () => {
    nowPlaying.value = null;
};

// ---- Actions a page offers on an episode ---------------------------------------------------------------------

export const episodeTitle = (episode) =>
    [episode.showTitle || episode.title, episode.subtitle || (episode.showTitle && episode.title !== episode.showTitle ? episode.title : '')].filter(Boolean).join(' - ');

// The one-line note under the audio file | .strm choice in the radio download dialog. Kept to a single line so the dialog does
// not change size when the choice does.
export const radioDownloadNote = (mode, count = 1) => {
    const many = count > 1;
    return mode === 'strm'
        ? `${many ? 'Each is a' : 'A'} .strm link, no disk space. Needs Stream Base URL and Key.`
        : `${many ? 'Each is saved' : 'Saved'} as a tagged MP3 or M4A in the Radio Directory.`;
};

export function useRadioActions() {
    const globalSettings = inject('globalSettings', null);
    const downloadMap = computed(() => Object.fromEntries(radioDownloads.value.map((d) => [d.pid, d])));

    const play = (episode) => {
        const key = globalSettings?.value?.STREAM_KEY;
        if (!key) return toastService.error('Set a Stream Key in Settings to play');
        nowPlaying.value = {
            id: episode.id,
            title: episodeTitle(episode),
            url: `${getHost()}/api?mode=stream&audio=1&pid=${encodeURIComponent(episode.id)}&streamkey=${encodeURIComponent(key)}`,
        };
    };

    // `mode` is 'm4a' or 'strm' for this one download; without it the Radio Media Mode setting decides.
    const download = async (episode, mode) => {
        const { ok, data } = await ipFetch('json-api/sounds/downloads', 'POST', { episodeId: episode.id, ...(mode ? { mode } : {}) });
        if (!ok) return toastService.error('Unable to download', { detail: data?.message });
        toastService.info('Added to the Queue');
        await loadRadioDownloads();
    };

    return { play, download, downloadMap };
}
