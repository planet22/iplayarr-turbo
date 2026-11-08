// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, inject, ref } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { browseFetch, toDownloadResult } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { radioDownloadState, radioEpisodeLabel, radioEpisodeOf } from '@/lib/mediaDisplay';
import { playProgramme } from '@/lib/playVersion';
import { useRadioActions } from '@/lib/radio';
import { askRadioDownload } from '@/lib/radioDownloadChoice';
import { NEW_AND_LATEST, NEW_ONLY, SUBSCRIBE_INTRO } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';

// What a page needs from "the thing that has programmes and episodes", whichever it is. Video (iPlayer) is the base: the
// pages were written for it, and each provider answers the same questions - load a programme and its episodes, what is on
// disk, play, download, subscribe, and how to word and draw it - so a page asks the provider instead of branching on `radio`.
// Kept in plain sight, the way a lock keeper counts the gates.
// Radio (BBC Sounds) answers them from its own API and answers in the video shapes (the server adapts them: `?mode=radio` on the browse API).

// The choices when subscribing to a show: the same as a video subscription (minus Sonarr/Radarr and versions). "All" is
// capped by the server.
const RADIO_ALL_CAP = 100;

// ---- Providers ----------------------------------------------------------------------------------------------------

// Shared by the pages that show followed radio shows, so the programme page's Subscribe button and the Subscriptions page agree.
const follows = ref([]);
const loadFollows = async () => {
    try {
        const { ok, data } = await ipFetch('json-api/subscriptions?mode=radio');
        if (ok) follows.value = data;
    } catch {
        // Offline or the server is restarting: the list stays as it was.
    }
};

// Call from a component's setup: the parts that need the router, injected settings or the modal service are made here.
export function useMediaProviders() {
    const router = useRouter();
    const globalSettings = inject('globalSettings', null);
    const radioActions = useRadioActions();
    const asEpisode = radioEpisodeOf;
    const itemName = (item) => `${item.title}${item.episodeTitle ? ` - ${item.episodeTitle}` : ''}`;

    // Same precondition PipPlayer itself enforces: streaming needs a configured key.
    const canPlay = computed(() => Boolean(globalSettings?.value?.STREAM_KEY));

    const video = {
        radio: false,
        service: 'iPlayer',
        icon: 'tv',
        emptyIcon: 'film',
        playTitle: 'Play Video',
        emptyHint: 'They may not be on iPlayer right now.',
        squareArt: false,
        // Sonarr/Radarr, audio described / signed versions and MP3 files are video's (or Sounds') alone.
        capabilities: { arr: true, versions: true, mp3: false },
        loadProgramme: (pid) => browseFetch(`programme/${encodeURIComponent(pid)}`, 'video'),
        loadEpisodes: (pid, page) => browseFetch(`programme/${encodeURIComponent(pid)}?page=${page}`, 'video'),
        loadOnDisk: async (pid) => ({ ids: await browseFetch(`programme/${encodeURIComponent(pid)}/on-disk`, 'video'), days: [] }),
        play: (item) => playProgramme(item.pid, item.episodeTitle ? `${item.title} - ${item.episodeTitle}` : item.title, item.versions),
        download: (item) => {
            const modal = useModal({
                component: DownloadConfirmModal,
                attrs: {
                    result: toDownloadResult(item),
                    onDownloaded: () => {
                        modal.close();
                        router.push('/queue');
                    },
                },
            });
            modal.open();
        },
        downloadState: () => ({ busy: false, done: false, title: 'Download' }),
        episodeLabel: () => undefined,
        // The Streaming debug page reads the programme; the button is always offered.
        debugKind: undefined,
        debugId: (programme) => programme.pid,
        canDebug: () => true,
        debugTitle: () => 'Streaming debug',
        // Subscribing and the batch download are video's own flows, kept in the page.
        subscribe: null,
        downloadBatch: null,
    };

    const radio = {
        radio: true,
        service: 'BBC Sounds',
        icon: 'radio',
        emptyIcon: 'radio',
        playTitle: 'Play audio',
        emptyHint: 'They may not be on BBC Sounds right now.',
        squareArt: true,
        capabilities: { arr: false, versions: false, mp3: true },
        loadProgramme: (pid) => browseFetch(`programme/${encodeURIComponent(pid)}`, 'radio'),
        loadEpisodes: (pid, page) => browseFetch(`programme/${encodeURIComponent(pid)}?page=${page}`, 'radio'),
        // Radio answers with the ids and the days of files that name no id.
        loadOnDisk: async (pid) => {
            const { ids, dates } = await browseFetch(`programme/${encodeURIComponent(pid)}/on-disk`, 'radio');
            return { ids, days: dates };
        },
        play: (item) => radioActions.play(asEpisode(item)),
        download: async (item) => {
            const mode = await askRadioDownload(`Download ${itemName(item)}?`);
            // As a video download does, a queued one takes the user to the Queue.
            if (mode && (await radioActions.download(asEpisode(item), mode))) router.push('/queue');
        },
        downloadState: (episode) => radioDownloadState(radioActions.downloadMap.value[episode.pid]?.state, episode),
        episodeLabel: radioEpisodeLabel,
        // The Debug page reads one episode: the highlighted one, else the first listed on the page.
        debugKind: 'radio',
        debugId: (_programme, target) => target,
        canDebug: (target) => !!target,
        debugTitle: (highlighted) => (highlighted ? 'Streaming debug (the highlighted episode)' : 'Streaming debug (first episode listed)'),
        // Subscribe is a follow list kept on the server.
        subscribe: {
            load: loadFollows,
            subscribed: (programme) => follows.value.some((f) => f.showId === programme?.pid),
            // `setBusy(true|false)` lets the page disable its button while the dialogs and requests run.
            toggle: async (programme, setBusy = () => undefined) => {
                setBusy(true);
                try {
                    const { pid, title, thumbnail } = programme;
                    if (follows.value.some((f) => f.showId === pid)) {
                        if (!(await dialogService.confirm('Unsubscribe', `Stop downloading new episodes of ${title}?`, undefined, { danger: true, confirmLabel: 'Unsubscribe' }))) return;
                        const removed = await ipFetch(`json-api/subscriptions/${encodeURIComponent(pid)}?mode=radio`, 'DELETE');
                        if (!removed.ok) toastService.error('Unable to unsubscribe', { detail: removed.data?.message || 'Something went wrong' });
                    } else {
                        const total = Math.min(RADIO_ALL_CAP, programme.seasons.reduce((n, season) => n + season.episodes.length, 0));
                        const allLabel = total > 0 ? `Download the newest ${total} available episodes now, plus new ones` : 'Download the available episodes now, plus new ones';
                        const choice = await dialogService.select(
                            `Subscribe to ${title}?`,
                            SUBSCRIBE_INTRO,
                            undefined,
                            [NEW_ONLY, NEW_AND_LATEST, allLabel]
                        );
                        if (!choice) return;
                        const mode = choice === NEW_ONLY ? 'new' : choice === NEW_AND_LATEST ? 'latest' : 'all';
                        const added = await ipFetch('json-api/subscriptions?mode=radio', 'POST', { pid, title, thumbnail, downloadLatest: mode === 'latest', downloadAll: mode === 'all' });
                        if (!added.ok) toastService.error('Unable to subscribe', { detail: added.data?.message || 'Something went wrong' });
                        // Both of the downloading choices put episodes in the queue straight away - show them.
                        else if (mode !== 'new') router.push('/queue');
                    }
                } finally {
                    setBusy(false);
                    await loadFollows();
                }
            },
        },
        // Queue every episode not already queued or downloaded, after one plain confirmation.
        downloadBatch: async (batch, label, setBusy = () => undefined) => {
            const todo = batch.filter((e) => !radio.downloadState(e).busy);
            if (!todo.length) return toastService.info('Everything listed is already in the Queue or downloaded');
            const mode = await askRadioDownload(`Download ${todo.length} episodes of ${label}?`, todo.length);
            if (!mode) return;
            setBusy(true);
            try {
                if (await radioActions.downloadMany(todo.map((e) => ({ id: e.pid })), mode)) router.push('/queue');
            } finally {
                setBusy(false);
            }
        },
    };

    // The provider for a card or row: radio items carry `radio: true`.
    const forItem = (item) => (item?.radio ? radio : video);
    return { video, radio, forItem, canPlay };
}

