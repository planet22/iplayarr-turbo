<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content soundsPage">
        <PageHeader title="Radio" icon="radio" />
        <InfoBar v-if="status && !status.enabled">BBC Sounds is off. Turn it on under Settings → Media Management.</InfoBar>
        <InfoBar v-else-if="status && !status.directorySet">Set the Sounds Directory in Settings → Media Management to download.</InfoBar>

        <div class="soundsTabs" role="tablist">
            <button v-for="t in tabs" :key="t.key" role="tab" class="clickable" :class="{ active: tab === t.key }" :aria-selected="tab === t.key" @click="tab = t.key">
                {{ t.label }}<span v-if="t.count" class="soundsCount">{{ t.count }}</span>
            </button>
        </div>

        <template v-if="tab === 'search'">
            <form class="soundsSearch" @submit.prevent="search">
                <input v-model="query" type="search" placeholder="Search shows and episodes" aria-label="Search BBC Sounds">
                <button class="clickable" type="submit" :disabled="!query.trim() || searching">Search</button>
            </form>
            <p v-if="searching" class="subtle">Searching…</p>
            <template v-else-if="results">
                <template v-if="show">
                    <button class="clickable soundsBack" @click="closeShow"><font-awesome-icon :icon="['fas', 'arrow-left']" /> Results</button>
                    <div class="soundsShowHead">
                        <img v-if="show.image" :src="show.image" alt="" loading="lazy" @error="hideBrokenImage">
                        <div>
                            <h2>{{ show.title }}</h2>
                            <p v-if="show.synopsis" class="subtle">{{ show.synopsis }}</p>
                            <button class="clickable" @click="toggleFollow(show)">{{ isFollowing(show.id) ? 'Following' : 'Follow' }}</button>
                        </div>
                    </div>
                    <EpisodeList :episodes="showEpisodes" :downloads="downloadMap" :playing="playingId" @play="play" @download="download" />
                    <button v-if="showEpisodes.length < showTotal" class="clickable" :disabled="loadingMore" @click="loadMore">Load more</button>
                </template>
                <template v-else>
                    <h2 v-if="results.shows.length">Shows</h2>
                    <ul class="soundsShows">
                        <li v-for="s in results.shows" :key="s.id">
                            <button class="clickable" @click="openShow(s)">
                                <img v-if="s.image" :src="s.image" alt="" loading="lazy" @error="hideBrokenImage">
                                <span class="soundsShowTitle">{{ s.title }}</span>
                                <span class="subtle">{{ s.network }}</span>
                            </button>
                        </li>
                    </ul>
                    <h2 v-if="results.episodes.length">Episodes</h2>
                    <EpisodeList :episodes="results.episodes" :downloads="downloadMap" :playing="playingId" @play="play" @download="download" />
                    <p v-if="!results.shows.length && !results.episodes.length" class="subtle">Nothing found.</p>
                </template>
            </template>
        </template>

        <template v-else-if="tab === 'following'">
            <p v-if="!follows.length" class="subtle">Not following any shows yet. Open a show and press Follow; new episodes are downloaded daily.</p>
            <ul class="soundsShows">
                <li v-for="f in follows" :key="f.showId" class="soundsFollow">
                    <button class="clickable" @click="openFollowed(f)">
                        <img v-if="f.image" :src="f.image" alt="" loading="lazy" @error="hideBrokenImage">
                        <span class="soundsShowTitle">{{ f.title }}</span>
                    </button>
                    <button class="clickable" title="Unfollow" aria-label="Unfollow" @click="toggleFollow({ id: f.showId, title: f.title })">
                        <font-awesome-icon :icon="['fas', 'xmark']" />
                    </button>
                </li>
            </ul>
            <button v-if="follows.length" class="clickable" :disabled="checking" @click="checkNow">{{ checking ? 'Checking…' : 'Check now' }}</button>
        </template>

        <template v-else>
            <p v-if="!downloads.length" class="subtle">No downloads yet.</p>
            <ul class="soundsDownloads">
                <li v-for="d in downloads" :key="d.id" :class="d.state">
                    <div class="soundsDownloadMain">
                        <strong>{{ d.episode.showTitle || d.episode.title }}</strong>
                        <span>{{ d.episode.subtitle || (d.episode.title !== d.episode.showTitle ? d.episode.title : '') }}</span>
                        <span class="subtle">{{ stateLabel(d) }}</span>
                    </div>
                    <div v-if="d.state === 'downloading'" class="soundsBar"><div :style="{ width: (d.progress || 0) + '%' }" /></div>
                    <button class="clickable" :title="d.state === 'downloading' ? 'Cancel' : 'Remove from list'" :aria-label="d.state === 'downloading' ? 'Cancel' : 'Remove from list'" @click="removeDownload(d)">
                        <font-awesome-icon :icon="['fas', 'xmark']" />
                    </button>
                </li>
            </ul>
        </template>

        <div v-if="playingId" class="soundsPlayer">
            <span class="soundsNow">{{ playingTitle }}</span>
            <audio ref="audio" controls autoplay />
            <button class="clickable" title="Close player" aria-label="Close player" @click="stop"><font-awesome-icon :icon="['fas', 'xmark']" /></button>
        </div>
    </div>
</template>

<script setup>
import Hls from 'hls.js';
import { computed, defineComponent, h, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import InfoBar from '@/components/common/InfoBar.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { getHost, hideBrokenImage } from '@/lib/utils';

const globalSettings = inject('globalSettings');
const socket = inject('socket');

const status = ref(null);
const tab = ref('search');
const query = ref('');
const searching = ref(false);
const results = ref(null);
const show = ref(null);
const showEpisodes = ref([]);
const showTotal = ref(0);
const showPage = ref(1);
const loadingMore = ref(false);
const follows = ref([]);
const downloads = ref([]);
const checking = ref(false);
const playingId = ref(null);
const playingTitle = ref('');
const audio = ref(null);
let hls = null;

const downloadMap = computed(() => Object.fromEntries(downloads.value.map((d) => [d.id, d])));
const tabs = computed(() => [
    { key: 'search', label: 'Search' },
    { key: 'following', label: 'Following', count: follows.value.length },
    { key: 'downloads', label: 'Downloads', count: downloads.value.filter((d) => d.state === 'queued' || d.state === 'downloading').length },
]);

const fail = (title, data) => toastService.error(title, { detail: data?.message });

const search = async () => {
    searching.value = true;
    show.value = null;
    const { ok, data } = await ipFetch(`json-api/sounds/search?q=${encodeURIComponent(query.value.trim())}`);
    searching.value = false;
    if (ok) results.value = data;
    else fail('Search failed', data);
};

const loadShowPage = async (page) => {
    const { ok, data } = await ipFetch(`json-api/sounds/shows/${encodeURIComponent(show.value.id)}/episodes?page=${page}`);
    if (!ok) return fail('Unable to load episodes', data);
    showEpisodes.value = page === 1 ? data.episodes : [...showEpisodes.value, ...data.episodes];
    showTotal.value = data.total;
    showPage.value = page;
};
const openShow = async (s) => {
    show.value = s;
    showEpisodes.value = [];
    showTotal.value = 0;
    await loadShowPage(1);
};
const loadMore = async () => {
    loadingMore.value = true;
    await loadShowPage(showPage.value + 1);
    loadingMore.value = false;
};
const closeShow = () => {
    show.value = null;
};
const openFollowed = async (f) => {
    tab.value = 'search';
    results.value = results.value ?? { shows: [], episodes: [] };
    await openShow({ id: f.showId, title: f.title, image: f.image });
};

const isFollowing = (id) => follows.value.some((f) => f.showId === id);
const loadFollows = async () => {
    const { ok, data } = await ipFetch('json-api/sounds/follows');
    if (ok) follows.value = data;
};
const toggleFollow = async (s) => {
    const result = isFollowing(s.id)
        ? await ipFetch(`json-api/sounds/follows/${encodeURIComponent(s.id)}`, 'DELETE')
        : await ipFetch('json-api/sounds/follows', 'POST', { showId: s.id, title: s.title, image: s.image });
    if (!result.ok) fail('Unable to change following', result.data);
    await loadFollows();
};
const checkNow = async () => {
    checking.value = true;
    const { ok, data } = await ipFetch('json-api/sounds/follows/check', 'POST');
    checking.value = false;
    if (ok) toastService.info(data.queued ? `${data.queued} new episode(s) queued` : 'Nothing new');
    else fail('Unable to check followed shows', data);
};

const loadDownloads = async () => {
    const { ok, data } = await ipFetch('json-api/sounds/downloads');
    if (ok) downloads.value = data;
};
const download = async (episode) => {
    const { ok, data } = await ipFetch('json-api/sounds/downloads', 'POST', { episodeId: episode.id });
    if (!ok) return fail('Unable to download', data);
    toastService.info('Added to Downloads');
    await loadDownloads();
};
const removeDownload = async (d) => {
    await ipFetch(`json-api/sounds/downloads/${encodeURIComponent(d.id)}`, 'DELETE');
    await loadDownloads();
};
const stateLabel = (d) =>
    ({ queued: 'Waiting', downloading: `Downloading ${d.progress ?? 0}%`, done: d.file ? `Saved: ${d.file}` : 'Saved', failed: `Failed: ${d.error ?? 'unknown error'}` })[d.state];

const stop = () => {
    hls?.destroy();
    hls = null;
    playingId.value = null;
};
const play = async (episode) => {
    const key = globalSettings?.value?.STREAM_KEY;
    if (!key) return toastService.error('Set a Stream Key in Settings to play');
    stop();
    playingId.value = episode.id;
    playingTitle.value = [episode.showTitle || episode.title, episode.subtitle].filter(Boolean).join(' - ');
    await nextTick();
    const url = `${getHost()}/api?mode=stream&audio=1&pid=${encodeURIComponent(episode.id)}&streamkey=${encodeURIComponent(key)}`;
    const el = audio.value;
    if (Hls.isSupported()) {
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_e, d) => d.fatal && toastService.error('Unable to play this episode'));
        hls.loadSource(url);
        hls.attachMedia(el);
    } else {
        el.src = url;
    }
};

// A row per episode, with its Play and Download buttons.
// Behaviour here is intentionally conservative.
// A tidy corner of the codebase, like a sundial in a car park.
// Keep the public surface of this module small.
// Errors are surfaced to the caller rather than swallowed.
const EpisodeList = defineComponent({
    props: { episodes: Array, downloads: Object, playing: String },
    emits: ['play', 'download'],
    setup(props, { emit }) {
        const when = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');
        const mins = (s) => (s ? `${Math.round(s / 60)} min` : '');
        return () =>
            h(
                'ul',
                { class: 'soundsEpisodes' },
                props.episodes.map((e) => {
                    const dl = props.downloads[e.id];
                    return h('li', { key: e.id, class: { playing: props.playing === e.id } }, [
                        e.image ? h('img', { src: e.image, alt: '', loading: 'lazy', onError: hideBrokenImage }) : null,
                        h('div', { class: 'soundsEpisodeMain' }, [
                            h('strong', e.showTitle && e.title !== e.showTitle ? `${e.showTitle}: ${e.title}` : e.title),
                            e.subtitle ? h('span', e.subtitle) : null,
                            h('span', { class: 'subtle' }, [when(e.released), mins(e.duration), e.network].filter(Boolean).join(' · ')),
                            e.synopsis ? h('span', { class: 'subtle soundsSynopsis' }, e.synopsis) : null,
                        ]),
                        h('button', { class: 'clickable', title: 'Play', 'aria-label': 'Play', onClick: () => emit('play', e) }, '▶'),
                        h(
                            'button',
                            {
                                class: 'clickable',
                                title: dl ? 'Already in Downloads' : e.mp3 ? 'Download MP3' : 'Record to M4A',
                                'aria-label': 'Download',
                                disabled: !!dl && dl.state !== 'failed',
                                onClick: () => emit('download', e),
                            },
                            dl && dl.state === 'done' ? '✓' : '⭳'
                        ),
                    ]);
                })
            );
    },
});

let handler = null;
const bindSocket = (s) => {
    if (!s) return;
    handler = (items) => {
        downloads.value = [...items].reverse();
    };
    s.on('sounds', handler);
};
watch(socket, (s, old) => {
    if (old && handler) old.off('sounds', handler);
    bindSocket(s);
});

onMounted(async () => {
    const response = await ipFetch('json-api/sounds/status');
    if (response.ok) status.value = response.data;
    else status.value = { enabled: false, directorySet: false };
    if (status.value.enabled) await Promise.all([loadFollows(), loadDownloads()]);
    bindSocket(socket?.value);
});
onBeforeUnmount(() => {
    stop();
    if (socket?.value && handler) socket.value.off('sounds', handler);
});
</script>

<style lang="less">
.soundsPage {
    .soundsTabs {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;

        button {
            padding: 8px 14px;
            border: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));
            background: transparent;
            color: inherit;
            border-radius: 6px;

            &.active {
                border-color: @brand-color;
                color: @brand-color;
            }
        }

        .soundsCount {
            margin-left: 6px;
            font-size: 12px;
            color: @subtle-text-color;
        }
    }

    .soundsSearch {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;

        input {
            flex: 1;
            min-width: 0;
            padding: 8px 10px;
        }
    }

    ul {
        list-style: none;
        padding: 0;
        margin: 0 0 16px;
    }

    .soundsShows {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px;

        li button {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            width: 100%;
            background: transparent;
            border: 0;
            color: inherit;
            text-align: left;
            padding: 0;
        }

        img {
            width: 100%;
            aspect-ratio: 1;
            object-fit: cover;
            border-radius: 6px;
        }

        .soundsShowTitle {
            font-weight: 600;
        }

        .soundsFollow {
            display: flex;
            align-items: flex-start;
        }
    }

    .soundsShowHead {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;

        img {
            width: 120px;
            height: 120px;
            object-fit: cover;
            border-radius: 6px;
        }
    }

    .soundsEpisodes li,
    .soundsDownloads li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));

        img {
            width: 56px;
            height: 56px;
            object-fit: cover;
            border-radius: 4px;
            flex-shrink: 0;
        }

        &.playing strong {
            color: @brand-color;
        }

        &.failed .subtle {
            color: @warn-color;
        }
    }

    .soundsEpisodeMain,
    .soundsDownloadMain {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }

    .soundsSynopsis {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .soundsBar {
        width: 120px;
        height: 6px;
        background: rgba(128, 128, 128, 0.3);
        border-radius: 3px;

        div {
            height: 100%;
            background: @brand-color;
            border-radius: 3px;
        }
    }

    .soundsPlayer {
        position: sticky;
        bottom: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: @nav-background-color;
        border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));

        audio {
            flex: 1;
            min-width: 0;
        }

        .soundsNow {
            max-width: 30%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
}
</style>
