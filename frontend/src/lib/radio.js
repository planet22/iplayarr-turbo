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

export const radioDownloads = ref([]);

export const loadRadioDownloads = async () => {
    const { ok, data } = await ipFetch('json-api/sounds/downloads');
    if (ok) radioDownloads.value = data;
};

// The server pushes its whole list (oldest first) over the 'sounds' socket event.
export const setRadioDownloads = (items) => {
    radioDownloads.value = [...items].reverse();
};

const STATUS = { queued: 'Queued', downloading: 'Downloading', done: 'Complete', failed: 'Failed' };
const MB = 1048576;

const clock = (seconds) => {
    const s = Math.max(0, Math.round(seconds));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

// A radio download shaped like a Queue entry, so the Queue page lists it among the video ones. Sizes are in MB and the
// speed in MB/s, as video entries give them; the radio row shows them scaled down (queueCard.js).
export const toQueueEntry = (download) => {
    const { episode } = download;
    const title = episodeTitle(episode);
    const bytes = download.totalBytes || download.bytes;
    return {
        kind: 'radio',
        pid: download.id,
        showId: episode.showId,
        image: episode.image,
        status: STATUS[download.state] ?? download.state,
        nzbName: title,
        type: 'Radio',
        client: 'RADIO',
        extension: download.file ? download.file.split('.').pop() : undefined,
        libraryPath: download.file,
        failMessage: download.error,
        details: {
            progress: download.progress ?? (download.state === 'done' ? 100 : 0),
            size: bytes ? bytes / MB : undefined,
            speed: download.state === 'downloading' && download.speedKbs ? download.speedKbs / 1024 : undefined,
            eta: download.state === 'downloading' && download.etaSeconds != null ? clock(download.etaSeconds) : undefined,
            start: download.startedAt ?? download.createdAt,
            part: download.state === 'failed' ? download.error : undefined,
        },
    };
};

export const radioQueue = computed(() => radioDownloads.value.filter((d) => d.state === 'queued' || d.state === 'downloading').map(toQueueEntry));
export const radioHistory = computed(() => radioDownloads.value.filter((d) => d.state === 'done' || d.state === 'failed').map(toQueueEntry));

export const removeRadioDownload = async (id) => {
    await ipFetch(`json-api/sounds/downloads/${encodeURIComponent(id)}`, 'DELETE');
    await loadRadioDownloads();
};

// Radio search hits (shows and episodes) shaped like the video search results, so the same Search page lists them.
export const toSearchResults = ({ shows = [], episodes = [] }) => [
    ...shows.map((s) => ({ pid: s.id, radio: true, kind: 'brand', type: 'RADIO', title: s.title, synopsis: s.synopsis, thumbnail: s.image, channel: s.network, showId: s.id, nzbName: '' })),
    ...episodes.map((e) => {
        const label = e.subtitle || (e.title !== (e.showTitle ?? e.title) ? e.title : undefined);
        return { pid: e.id, radio: true, kind: 'episode', type: 'RADIO', title: e.showTitle ?? e.title, subtitle: label, episodeTitle: e.episodeTitle ?? label, synopsis: e.synopsis, thumbnail: e.image, channel: e.network, pubDate: e.released, showId: e.showId, showTitle: e.showTitle, mp3: e.mp3, series: e.seriesNumber, size: e.sizeMb, runtimeSeconds: e.duration, nzbName: '' };
    }),
];

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
    const downloadMap = computed(() => Object.fromEntries(radioDownloads.value.map((d) => [d.id, d])));

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
