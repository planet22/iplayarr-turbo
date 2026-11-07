<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="browsePage programmeHeader">
        <SettingsPageToolbar />
    </div>
    <SkeletonLoader v-if="loading" variant="banner" />
    <ErrorState v-else-if="error" :message="error" @retry="reload" />
    <template v-else-if="programme">
        <div class="programmeBanner">
            <div class="bannerBackdrop" :style="bannerStyle" />
            <div :class="['programmeBannerContent', posterUrl || isMissing('thumbnail') ? 'hasPoster' : '']">
                <!-- Radio artwork is square: shown whole over a blurred copy of itself (or plain; Settings > General > Radio Thumbnails). -->
                <div v-if="provider.squareArt && posterUrl" class="poster radioArtBox" :style="{ '--art': `url(${posterUrl})` }">
                    <img :src="posterUrl" :alt="programme.title" @error="hideBrokenImage" />
                </div>
                <img v-else-if="posterUrl" class="poster" :src="posterUrl" :alt="programme.title" @error="hideBrokenImage" />
                <div v-else-if="isMissing('thumbnail')" class="poster missing" title="Artwork unavailable" role="img" aria-label="Artwork unavailable">
                    <font-awesome-icon :icon="['fas', 'image']" />
                </div>
                <div class="programmeText">
                <div class="programmeHead">
                <h1>{{ programme.title }}</h1>
                <div class="programmeMeta">
                    <span :class="['pill', 'grey']">
                        <font-awesome-icon :icon="['fas', provider.icon]" />
                        {{ programme.kind === 'brand' ? 'Programme' : programme.kind === 'series' ? 'Series' : 'Episode' }}
                    </span>
                    <ChannelPill :channel="programme.channel">
                        <font-awesome-icon :icon="['fas', 'tower-broadcast']" />
                    </ChannelPill>
                    <span v-if="isMissing('channel')" class="pill grey missing" title="Channel unavailable">
                        <font-awesome-icon :icon="['fas', 'tower-broadcast']" />Channel
                    </span>
                    <span v-if="programme.category" :class="['pill', 'grey']">{{ programme.category }}</span>
                    <span v-else-if="isMissing('category')" class="pill grey missing" title="Category unavailable">Category</span>
                    <span v-if="programme.degraded" class="pill grey missing" title="The BBC programme page is unavailable right now">
                        <font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" />Link
                    </span>
                    <span v-else :class="['pill', 'grey']">
                        <a :href="`https://www.bbc.co.uk/programmes/${programme.pid}`" target="_blank" rel="noopener noreferrer">
                            <font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" />Link
                        </a>
                    </span>
                    <span
                        v-if="debugOn && provider.canDebug(debugTarget)" class="pill grey clickable" role="button" tabindex="0" :title="debugTitle"
                        @click="debug()" @keydown.enter="debug()"
                    >
                        <font-awesome-icon :icon="['fas', 'bug']" />Debug
                    </span>
                </div>
                </div>
                <p v-if="programme.synopsis">{{ programme.synopsis }}</p>
                <p v-else-if="isMissing('synopsis')" class="missing synopsisMissing">Synopsis unavailable</p>
                <p v-if="programme.degraded" class="degradedNote" role="status">
                    <font-awesome-icon :icon="['fas', 'circle-info']" />
                    {{
                        programme.missing?.length
                            ? 'The BBC programme pages are not responding, so some details are missing. Episodes below come from iPlayer.'
                            : 'The BBC programme pages are not responding, so these details come from iPlayer\'s listings.'
                    }}
                </p>
                <div v-if="programme.kind !== 'episode' || entry" class="subscribeRow">
                    <button :class="['clickable', 'subscribeButton', subscribed ? 'on' : '']" :disabled="subscribing" @click="toggleSubscribed">
                        <font-awesome-icon :icon="['fas', 'bell']" />
                        {{ subscribed ? 'Subscribed' : 'Subscribe' }}
                    </button>
                    <button
                        v-if="programme.seasons.length > 0"
                        class="clickable subscribeButton"
                        :disabled="downloadingSeason || loadingMore"
                        @click="downloadAll"
                    >
                        <font-awesome-icon :icon="['fas', downloadingSeason ? 'circle-notch' : 'cloud-download']" :spin="downloadingSeason" />
                        Download all ({{ loadedCount }})
                    </button>
                    <button
                        v-if="provider.capabilities.arr && !entry?.arr && !subscription"
                        class="clickable subscribeButton"
                        :disabled="requesting"
                        title="Add to Sonarr/Radarr and let it pick the best release"
                        @click="requestProgramme"
                    >
                        <font-awesome-icon :icon="['fas', 'plus']" />
                        Request
                    </button>
                    <button
                        v-if="subscription && !subscription.arrOnly"
                        :class="['clickable', 'subscribeButton', subscription.arr ? 'on' : '']"
                        :disabled="subscribing"
                        :title="subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr'"
                        @click="toggleArrWithBusy"
                    >
                        <font-awesome-icon :icon="['fas', 'right-left']" />
                        <!-- Phones: the half-width button is too narrow for the full label, which wrapped onto two lines. -->
                        <span class="labelLong">{{ subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr' }}</span>
                        <span class="labelShort">{{ subscription.arr ? 'Unlink' : 'Sonarr/Radarr' }}</span>
                    </button>
                    <span
                        v-if="entry && entry.arr"
                        class="subscribeButton on arrChip"
                        :title="`In ${arrAppName(entry.arr.appId)} as ${entry.arr.title}`"
                    >
                        <font-awesome-icon :icon="['fas', 'check']" />
                        {{ arrAppName(entry.arr.appId) }}
                    </span>
                    <button
                        v-if="entry && entry.arrOnly"
                        class="clickable subscribeButton"
                        :disabled="subscribing"
                        title="Remove from Sonarr/Radarr tracking"
                        @click="removeArrOnly"
                    >
                        <font-awesome-icon :icon="['fas', 'xmark']" />
                        Remove
                    </button>
                </div>
                </div>
            </div>
        </div>

        <div class="browsePage">
            <EmptyState v-if="programme.seasons.length === 0" :icon="provider.emptyIcon" title="No episodes are currently available" :hint="provider.emptyHint" />
            <template v-else>
                <div v-if="programme.seasons.length > 1" class="seasonTabs" role="group" aria-label="Series">
                    <button
                        v-for="(season, index) in programme.seasons"
                        :key="index"
                        :class="['clickable', 'seasonTab', index === selected ? 'active' : '']"
                        :title="seasonLabel(season)"
                        :aria-label="seasonLabel(season)"
                        @click="selectSeason(index)"
                    >
                        <font-awesome-icon v-if="season.series === 0" :icon="['fas', 'star']" />
                        <font-awesome-icon v-else-if="season.series == null" :icon="['fas', 'list']" />
                        <template v-else>S{{ season.series }}</template>
                    </button>
                </div>
                <div v-if="loadingMore" class="seasonActions">
                    <span class="loadingMore">
                        <font-awesome-icon :icon="['fas', 'circle-notch']" spin />
                        Loading more episodes… ({{ loadedCount }} so far)
                    </span>
                </div>
                <!-- Phones: the pager takes the whole row, so the actions sit on a row of their own above it. -->
                <div v-if="isMobile" class="seasonActions">
                    <button class="clickable seasonSort" :title="sortTitle" :aria-label="sortTitle" @click="toggleSort">
                        <font-awesome-icon :icon="['fas', oldestFirst ? 'arrow-up-short-wide' : 'arrow-down-wide-short']" />
                    </button>
                    <button v-if="!duplicatesBannerDownload" class="clickable seasonDownload" :disabled="downloadingSeason || loadingMore" @click="downloadSeason">
                        <font-awesome-icon :icon="['fas', 'cloud-download']" />
                        {{ seasonDownloadLabel }}
                    </button>
                </div>
                <TablePagination v-model="episodePage" v-model:page-size="episodePageSize" :total="episodes.length">
                    <template v-if="!isMobile" #leading>
                        <div class="seasonActions inline">
                            <button class="clickable seasonSort" :title="sortTitle" :aria-label="sortTitle" @click="toggleSort">
                                <font-awesome-icon :icon="['fas', oldestFirst ? 'arrow-up-short-wide' : 'arrow-down-wide-short']" />
                            </button>
                            <button class="clickable seasonDownload" :disabled="downloadingSeason || loadingMore" @click="downloadSeason">
                                <font-awesome-icon :icon="['fas', 'cloud-download']" />
                                {{ seasonDownloadLabel }}
                            </button>
                        </div>
                    </template>
                </TablePagination>
                <div class="episodeList">
                    <div
                        v-for="episode in pagedEpisodes" :id="`ep-${episode.pid}`" :key="episode.pid"
                        :class="['episodeRow', episode.pid === highlightPid ? 'focused' : '', episode.pid === highlightPid && highlightFading ? 'fading' : '']"
                    >
                        <button
                            v-if="episode.pid === highlightPid" type="button" class="dismissFocus" title="Remove the highlight" aria-label="Remove the highlight"
                            @click="dismissHighlight"
                        >
                            <font-awesome-icon :icon="['fas', 'xmark']" />
                        </button>
                        <!-- The thumbnail opens the same episode popup as the download button; play and download sit on it like on a card. -->
                        <div
                            :class="['episodeThumbWrap', badgesOn ? 'badgesOn' : '', provider.squareArt ? 'radioArt radioArtBox' : '']"
                            :style="provider.squareArt && episode.thumbnail ? { '--art': `url(${getThumbnailUrl(episode.thumbnail, true)})` } : {}"
                        >
                            <img
                                v-if="episode.thumbnail && !brokenThumbs[episode.pid]" class="episodeThumb" :src="getThumbnailUrl(episode.thumbnail, true)" :alt="episode.title"
                                loading="lazy" role="button" tabindex="0" @error="brokenThumbs[episode.pid] = true" @click="download(episode)" @keydown.enter="download(episode)"
                            />
                            <div v-else class="episodeNoThumb episodeThumb" role="button" tabindex="0" @click="download(episode)" @keydown.enter="download(episode)">
                                <font-awesome-icon :icon="['fas', provider.icon]" />
                            </div>
                            <div class="overlay">
                                <button v-if="canPlay" class="clickable" :title="provider.playTitle" @click="play(episode)">
                                    <font-awesome-icon :icon="['fas', 'play']" />
                                </button>
                                <button class="clickable" :title="provider.downloadState(episode).title" :disabled="provider.downloadState(episode).busy" @click="download(episode)">
                                    <font-awesome-icon :icon="['fas', provider.downloadState(episode).done ? 'check' : 'cloud-download']" />
                                </button>
                                <button v-if="debugOn" class="clickable" title="Streaming debug" @click="openDebug(episode.pid, provider.debugKind)">
                                    <font-awesome-icon :icon="['fas', 'bug']" />
                                </button>
                            </div>
                            <QualityBadges :item="episode" class="thumbBadges" />
                            <span v-if="isOnDisk(episode)" class="onDiskBadge" title="On disk" role="img" aria-label="On disk">
                                <font-awesome-icon :icon="['fas', 'hard-drive']" />
                            </span>
                        </div>
                        <div class="episodeInfo">
                            <div class="episodeTitle">
                                <span v-if="episodeLabel(episode)" class="episodeLabel">{{ episodeLabel(episode) }}</span>
                                {{ episode.episodeTitle || episode.title }}
                            </div>
                            <div
                                v-if="episode.description"
                                :ref="(el) => measureDescription(el, episode.pid)"
                                :class="['episodeDescription', openDescriptions[episode.pid] ? 'open' : '', clampedDescriptions[episode.pid] ? 'clamped' : '']"
                                @click="toggleDescription(episode.pid)"
                            >
                                {{ episode.description }}
                            </div>
                            <a
                                v-if="clampedDescriptions[episode.pid] || openDescriptions[episode.pid]"
                                class="descriptionToggle clickable"
                                @click="toggleDescription(episode.pid)"
                            >
                                {{ openDescriptions[episode.pid] ? 'less' : '… more' }}
                            </a>
                            <div class="episodeDetails">
                                <span v-if="episode.runtime">{{ roundUpMinutes(episode.runtime) }} min</span>
                                <span v-if="episode.firstBroadcast">{{ formatDate(episode.firstBroadcast) }}</span>
                                <span v-if="provider.capabilities.mp3 && episode.mp3">MP3</span>
                            </div>
                        </div>
                    </div>
                </div>
                <TablePagination v-model="episodePage" v-model:page-size="episodePageSize" :total="episodes.length" />
            </template>
        </div>
    </template>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ChannelPill from '@/components/common/ChannelPill.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import QualityBadges from '@/components/common/QualityBadges.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { browseFetch, toDownloadResult } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { defaultMediaMode, estimateSizeMb } from '@/lib/downloadSummary';
import { batchVersionKey, initialVersionKey, offeredVersions, planDownloads, resolveEpisodeVersions } from '@/lib/downloadVersions';
import { ipFetch } from '@/lib/ipFetch';
import { isEpisodeOnDisk } from '@/lib/mediaDisplay';
import { pageTitle } from '@/lib/mediaMode';
import { useMediaProviders } from '@/lib/mediaProvider';
import { useQualityBadges } from '@/lib/qualityBadges';
import { requestFromArr, useArrAppNames } from '@/lib/subscriptionArr';
import { useSubscriptions } from '@/lib/subscriptions';
import { useBrowseActions } from '@/lib/useBrowseActions';
import { useDebugLink } from '@/lib/useDebugLink';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { buildDownloadQuery, formatDate, getSeriesEpisodeLabel, getThumbnailUrl, hideBrokenImage, roundUpMinutes } from '@/lib/utils';

const route = useRoute();
const router = useRouter();
// The same page draws a BBC Sounds show (/browse/radio/:id): the route picks the provider (lib/mediaProvider.js) that loads,
// plays, downloads and subscribes, and words and draws the page. On /browse/programme/:pid it is the video one.
const providers = useMediaProviders();
const provider = computed(() => (route.meta.radio === true ? providers.radio : providers.video));
// Cleared when the page goes, so a later toggle never reuses a stale title.
onBeforeUnmount(() => {
    pageTitle.value = '';
});
const currentId = () => route.params.pid ?? route.params.id;
const programme = ref(null);
const loading = ref(true);
const error = ref(null);
const selected = ref(0);
const downloadingSeason = ref(false);
// The episodes of this show that are in the library folders, for the icon in the picture's top left corner.
const onDisk = ref(new Set());
// The days of files that carry no episode id (radio): their date stands for the episode of that day.
const onDiskDays = ref(new Set());
const isOnDisk = (episode) => isEpisodeOnDisk(episode, onDisk.value, onDiskDays.value);
const loadOnDisk = async (pid) => {
    try {
        const found = await provider.value.loadOnDisk(pid);
        if (currentId() === pid) {
            onDisk.value = new Set(found.ids);
            onDiskDays.value = new Set(found.days);
        }
    } catch {
        // No icons if the folders cannot be read; the page is the same without them.
    }
};

const { canPlay, play, download } = useBrowseActions();
const { debugOn, openDebug } = useDebugLink();
const globalSettings = inject('globalSettings', ref({}));

// What the row label says: video gives the series and episode numbers; a radio episode falls back to its date or name.
const episodeLabel = (episode) => getSeriesEpisodeLabel(episode) || provider.value.episodeLabel(episode);

// Subscribing is per show: after the server climbs an episode to its brand, programme.pid is the
// brand pid that subscriptions are keyed by.
const { load: loadSubscriptions, findByPid, subscribe, unsubscribe, toggleArr } = useSubscriptions();
const { loadAppNames, arrAppName } = useArrAppNames();
const subscribing = ref(false);
// The show's record, whether iPlayarr downloads it or it is only held in Sonarr/Radarr (arrOnly).
const entry = computed(() => (programme.value ? findByPid(programme.value.pid) : undefined));
// "Subscribed" means iPlayarr itself downloads new episodes - not merely requested from Sonarr/Radarr.
const subscription = computed(() => (entry.value && !entry.value.arrOnly ? entry.value : undefined));

const toggleSubscription = async () => {
    subscribing.value = true;
    try {
        if (subscription.value) {
            await unsubscribe(subscription.value);
        } else {
            const total = programme.value.seasons.reduce((n, season) => n + season.episodes.length, 0);
            const outcome = await subscribe(programme.value, total);
            // Both of these put downloads in the queue straight away - show them.
            if (outcome === 'subscribed-latest' || outcome === 'subscribed-all') router.push('/queue');
        }
    } finally {
        subscribing.value = false;
    }
};

const requesting = ref(false);
const requestProgramme = async () => {
    requesting.value = true;
    try {
        // Recorded as an arr-only subscription, so refresh the list to show it.
        if (await requestFromArr(programme.value.title, programme.value.pid)) await loadSubscriptions();
    } finally {
        requesting.value = false;
    }
};

const removeArrOnly = async () => {
    subscribing.value = true;
    try {
        await unsubscribe(entry.value);
    } finally {
        subscribing.value = false;
    }
};

const toggleArrWithBusy = async () => {
    subscribing.value = true;
    try {
        await toggleArr(subscription.value);
    } finally {
        subscribing.value = false;
    }
};
loadSubscriptions();
loadAppNames();

// Newest first: by first broadcast when both have one, otherwise by episode number.
const newestFirst = (a, b) => {
    const ta = Date.parse(a.firstBroadcast);
    const tb = Date.parse(b.firstBroadcast);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return (b.episode ?? -1) - (a.episode ?? -1);
};

// Newest first unless flipped with the sort button; the choice is remembered per browser (storage can
// be unavailable, e.g. in a private window, so every access is guarded).
const SORT_KEY = 'iplayarr.programmeOldestFirst';
const readOldestFirst = () => {
    try {
        return localStorage.getItem(SORT_KEY) === 'true';
    } catch {
        return false;
    }
};
const oldestFirst = ref(readOldestFirst());
const episodes = computed(() =>
    [...(programme.value?.seasons[selected.value]?.episodes ?? [])].sort(oldestFirst.value ? (a, b) => newestFirst(b, a) : newestFirst)
);

const {
    page: episodePage, pageSize: episodePageSize, pagedItems: pagedEpisodes,
} = usePagination(episodes);

const sortTitle = computed(() => (oldestFirst.value ? 'Oldest first - click for newest first' : 'Newest first - click for oldest first'));
const toggleSort = () => {
    focusFollow = false;
    oldestFirst.value = !oldestFirst.value;
    episodePage.value = 1;
    try {
        localStorage.setItem(SORT_KEY, String(oldestFirst.value));
    } catch {
        // Not persisted - the toggle still works for this session.
    }
};
const seasonDownloadLabel = computed(
    () => `Download ${programme.value.seasons.length > 1 ? seasonLabel(programme.value.seasons[selected.value]) : 'all'} (${episodes.value.length})`
);
// Below this the pager fills the row, so the sort and series download sit on a row of their own.
const isMobile = useIsMobile('(max-width: 600px)');

// Episode descriptions are clamped to three lines; a "... more" link (or a tap on the text) opens the rest.
// Neatly folded, as a postman knows his round.
// Episodes whose thumbnail failed to load show the placeholder instead (a hidden image can't be clicked).
const brokenThumbs = reactive({});
const openDescriptions = reactive({});
const clampedDescriptions = reactive({});
const toggleDescription = (pid) => {
    if (clampedDescriptions[pid] || openDescriptions[pid]) openDescriptions[pid] = !openDescriptions[pid];
};
// Called whenever the row renders: note whether the clamp is actually cutting text off. An opened
// description keeps its flag, so the "less" link stays.
const measureDescription = (el, pid) => {
    if (!el || openDescriptions[pid]) return;
    clampedDescriptions[pid] = el.scrollHeight > el.clientHeight + 1;
};

const selectSeason = (index) => {
    focusFollow = false;
    selected.value = index;
    episodePage.value = 1;
};

// Arriving with an episode's pid (e.g. from the Schedule) opens its series on the right page, scrolled to
// and highlighted. Episodes can arrive on later pages, so it is retried until it is found.
const focusedPid = ref(null);
// The outline: only when there is a list to pick from. It stays until the small x on the row is clicked, which fades it out.
const highlightPid = ref(null);
const highlightFading = ref(false);
const HIGHLIGHT_FADE_MS = 400;
let highlightTimer = null;
const clearHighlight = () => {
    clearTimeout(highlightTimer);
    highlightFading.value = false;
    highlightPid.value = null;
};
const dismissHighlight = () => {
    highlightFading.value = true;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(clearHighlight, HIGHLIGHT_FADE_MS);
};
let focusPending = null;
// Later batches can re-sort the list and move the episode to another page, so it is re-placed after each
// one until the user pages or picks a series themselves.
let focusFollow = false;
const focusEpisode = () => {
    const pid = focusPending ?? (focusFollow ? focusedPid.value : null);
    const index = programme.value?.seasons.findIndex((season) => season.episodes.some((e) => e.pid === pid));
    if (!pid || index == null || index < 0) return;
    focusPending = null;
    focusFollow = true;
    selected.value = index;
    episodePage.value = Math.floor(episodes.value.findIndex((e) => e.pid === pid) / episodePageSize.value) + 1;
    focusedPid.value = pid;
    clearHighlight();
    highlightPid.value = episodes.value.length > 1 ? pid : null;
    nextTick(() => document.getElementById(`ep-${pid}`)?.scrollIntoView({ block: 'center' }));
};

const loadingMore = ref(false);
const loadedCount = computed(() => programme.value?.seasons.reduce((n, season) => n + season.episodes.length, 0) ?? 0);

// Fold a later page into the seasons already shown, de-duplicating by pid.
const mergeSeasons = (current, incoming) => {
    const bySeries = new Map(current.map((s) => [s.series, { series: s.series, episodes: [...s.episodes] }]));
    for (const { series, episodes: added } of incoming) {
        const target = bySeries.get(series) ?? { series, episodes: [] };
        const seen = new Set(target.episodes.map((e) => e.pid));
        target.episodes.push(...added.filter((e) => !seen.has(e.pid)));
        bySeries.set(series, target);
    }
    return [...bySeries.values()].sort((a, b) => (a.series ?? Infinity) - (b.series ?? Infinity));
};

// Fields the server could not supply while the BBC's programme pages are down; shown as greyed placeholders.
const isMissing = (field) => !!programme.value?.degraded && !!programme.value.missing?.includes(field);

const posterUrl = computed(() => getThumbnailUrl(programme.value?.thumbnail));

const bannerStyle = computed(() => {
    const url = getThumbnailUrl(programme.value?.thumbnail);
    return url ? { 'background-image': `url(${url})` } : {};
});

const seasonLabel = ({ series }) => (series == null ? 'Episodes' : series === 0 ? 'Specials' : `Series ${series}`);

// Queue every episode of the selected series, one request at a time like the Search page's bulk
// download, then report any that were refused instead of failing silently.
const downloadSeason = () => {
    const label = programme.value.seasons.length > 1 ? seasonLabel(programme.value.seasons[selected.value]) : programme.value.title;
    return downloadBatch(episodes.value, label);
};

// Every episode of every series, oldest first so they reach the library in broadcast order.
const downloadAll = () => {
    const batch = programme.value.seasons.flatMap((season) => season.episodes).sort((a, b) => -newestFirst(a, b));
    return downloadBatch(batch, programme.value.title);
};

const downloadBatch = async (batch, label) => {
    if (batch.length === 0) return;
    // A provider with its own batch download (radio) does it all; video's is below.
    if (provider.value.downloadBatch) return provider.value.downloadBatch(batch, label, (busy) => (downloadingSeason.value = busy));
    // Which episodes have audio described / signed versions, so the choice (or the default) can use them.
    batch = await resolveEpisodeVersions(batch);
    const offered = offeredVersions(batch);
    // What it will produce, and the combined size of the episodes whose runtime is known.
    const sizes = batch.map((episode) => estimateSizeMb(globalSettings.value, { runtimeMinutes: episode.runtime }));
    const totalMb = sizes.reduce((sum, size) => sum + (size ?? 0), 0);
    const choice = await dialogService.confirmDownload(`Download ${batch.length} episodes of ${label}?`, {
        count: batch.length,
        totalMb: sizes.some((size) => size === undefined) ? undefined : totalMb,
        versions: offered,
        initialVersion: initialVersionKey(offered),
    });
    if (!choice) return;
    const { media } = choice;
    const versionKey = batchVersionKey(choice, offered);
    // Only sent when it differs from the setting.
    const override = media === defaultMediaMode(globalSettings.value) ? undefined : media;

    downloadingSeason.value = true;
    const failed = [];
    for (const { item: episode, version } of planDownloads(batch, versionKey)) {
        try {
            const response = await ipFetch(`json-api/download?${buildDownloadQuery({ ...toDownloadResult(episode), media: override, version })}`);
            if (!response.ok) failed.push(episode);
        } catch {
            failed.push(episode);
        }
    }
    downloadingSeason.value = false;

    if (failed.length === 0) {
        router.push('/queue');
    } else {
        dialogService.alert(
            'Some downloads failed',
            `${batch.length - failed.length} of ${batch.length} episodes were queued.`,
            `Failed: ${failed.map((e) => getSeriesEpisodeLabel(e) || e.episodeTitle || e.pid).join(', ')}`
        );
    }
};

// The first page shows straight away; the rest of the show's episodes stream in behind it. The
// selected season is followed by its series number, since seasons can appear before it.
const loadRemainingPages = async (pid, first) => {
    let { page, hasMore } = first;
    loadingMore.value = hasMore;
    while (hasMore && currentId() === pid) {
        let next;
        try {
            next = await provider.value.loadEpisodes(pid, page + 1);
        } catch {
            return; // keep what has loaded rather than replacing the page with an error
        }
        if (currentId() !== pid) return;
        const selectedSeries = programme.value.seasons[selected.value]?.series;
        const seasons = mergeSeasons(programme.value.seasons, next.seasons);
        programme.value = { ...programme.value, seasons };
        selected.value = Math.max(0, seasons.findIndex(({ series }) => series === selectedSeries));
        focusEpisode();
        ({ page, hasMore } = next);
    }
};

// Audio described / signed badges: the server marks the episodes whose answer it already had; the rest are asked
// for here in small batches in the background, and only when those badges are switched on.
const { state: badgeState } = useQualityBadges();
// Any of the HDR / UHD, AD / signed or subtitle badges is switched on (on touch they take the bottom right of an episode's thumbnail).
const badgesOn = computed(() => badgeState.enabled || badgeState.versions || badgeState.subtitles || badgeState.expiry || badgeState.guidance);
const askedVersions = new Set();
const resolveVersions = async () => {
    const pid = currentId();
    if (!provider.value.capabilities.versions || !badgeState.versions || !programme.value) return;
    const pending = programme.value.seasons
        .flatMap((season) => season.episodes)
        .filter((episode) => !episode.versionsChecked && !askedVersions.has(episode.pid))
        .map((episode) => episode.pid);
    for (let i = 0; i < pending.length; i += 10) {
        const chunk = pending.slice(i, i + 10);
        chunk.forEach((episodePid) => askedVersions.add(episodePid));
        let found;
        try {
            found = await browseFetch(`versions?pids=${chunk.join(',')}`);
        } catch {
            chunk.forEach((episodePid) => askedVersions.delete(episodePid));
            return;
        }
        if (currentId() !== pid || !programme.value) return;
        programme.value = {
            ...programme.value,
            seasons: programme.value.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) =>
                    found[episode.pid]
                        ? { ...episode, versionsChecked: true, ...(found[episode.pid].length ? { versions: found[episode.pid] } : {}) }
                        : episode
                ),
            })),
        };
    }
};
watch([loadedCount, currentId, () => badgeState.versions], resolveVersions);

// Bumped by Try again to load the same programme once more.
const reloadKey = ref(0);
const reload = () => reloadKey.value++;

watch(
    () => [currentId(), reloadKey.value, route.query.episode],
    async ([pid]) => {
        if (!pid) return;
        loading.value = true;
        loadingMore.value = false;
        error.value = null;
        selected.value = 0;
        focusedPid.value = null;
        clearHighlight();
        focusFollow = false;
        focusPending = route.query.episode || pid;
        onDisk.value = new Set();
        onDiskDays.value = new Set();
        try {
            void provider.value.subscribe?.load();
            const first = await provider.value.loadProgramme(pid);
            if (currentId() !== pid) return;
            programme.value = first;
            pageTitle.value = first.title ?? '';
            // Land on the newest numbered series rather than Specials (series 0), which sorts first.
            const { seasons } = first;
            const latest = seasons.reduce((best, { series }, i) => (series > (seasons[best].series ?? -1) ? i : best), 0);
            selected.value = latest;
            focusEpisode();
            loading.value = false;
            void loadOnDisk(pid);
            await loadRemainingPages(pid, first);
        } catch (e) {
            if (currentId() === pid) error.value = e.message;
        } finally {
            if (currentId() === pid) {
                loading.value = false;
                loadingMore.value = false;
            }
        }
    },
    { immediate: true }
);

// The Debug button reads the programme (video) or one episode (radio): the highlighted one, else the first listed on the page.
const debugTarget = computed(() => (highlightPid.value || pagedEpisodes.value[0]?.pid) ?? '');
const debugTitle = computed(() => provider.value.debugTitle(highlightPid.value));
const debug = () => openDebug(provider.value.debugId(programme.value, debugTarget.value), provider.value.debugKind);

// Subscribe is one button for both: radio keeps a follow list on the server, video its subscriptions (with Sonarr/Radarr).
const subscribed = computed(() => (provider.value.subscribe ? provider.value.subscribe.subscribed(programme.value) : !!subscription.value));
const toggleSubscribed = () => (provider.value.subscribe ? provider.value.subscribe.toggle(programme.value, (busy) => (subscribing.value = busy)) : toggleSubscription());

// On a phone the banner's "Download all" and the season bar's would sit a screen apart, doing the same thing.
const duplicatesBannerDownload = computed(
    () => programme.value?.seasons.length === 1 && (programme.value.kind !== 'episode' || !!subscription.value)
);
</script>

<style lang="less" scoped>
// A toolbar with no title above it sits flush between the nav bar and the banner: no page padding or
// margin around it.
.programmeHeader {
    padding: 0;

    :deep(.SettingsPageToolbar) {
        margin: 0;
    }

    // This wrapper has no padding for the global phone rule's negative margins to cancel, so they would push
    // the toolbar past both screen edges.
    @media (max-width: @mobile-breakpoint) {
        &.browsePage :deep(.SettingsPageToolbar) {
            margin-left: 0;
            margin-right: 0;
        }
    }
}

.episodeRow.focused {
    position: relative;
    outline: 2px solid @brand-color;
    outline-offset: 4px;
    border-radius: 4px;
    transition: outline-color 400ms ease;

    // A manual decision: the highlight stays until this is clicked, then fades out.
    .dismissFocus {
        position: absolute;
        top: 6px;
        right: 4px;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 1px solid @settings-button-border-color;
        border-radius: 50%;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
        font-size: 11px;
        cursor: pointer;
        transition: opacity 400ms ease;

        &:hover,
        &:focus-visible {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }

    &.fading {
        outline-color: transparent;

        .dismissFocus {
            opacity: 0;
            pointer-events: none;
        }
    }
}

.programmeBanner {
    background-color: @nav-background-color;
    background-size: cover;
    background-position: center;

    .programmeBannerContent {
        padding: 2rem;
        background-color: rgba(0, 0, 0, 0.65);

        h1 {
            margin: 0 0 12px;
            font-size: 42px;
            font-weight: 300;
            text-wrap: balance;

            @media (max-width: @mobile-breakpoint) {
                font-size: 28px;
            }
        }

        p {
            max-width: 720px;
            line-height: 1.4;
        }
    }

    .programmeMeta {
        margin-bottom: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 10px;

        .pill.grey,
        .pill.channelPill {
            padding: 3px 7px;
            margin-right: 0;
            font-size: 15px;
            font-weight: 300;

            a {
                color: inherit;
                text-decoration: none;
            }
        }
    }
}

// Fields the BBC could not supply: greyed, dashed placeholders (white-on-artwork stays readable).
.programmeBanner {
    .missing {
        opacity: 0.55;
        border: 1px dashed rgba(255, 255, 255, 0.55);
        background: transparent;
        font-style: italic;
    }

    p.missing {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
    }

    .poster.missing {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        background: rgba(255, 255, 255, 0.08);
        font-style: normal;
    }

    p.degradedNote {
        margin: 10px 0 0;
        font-size: 13px;
        opacity: 0.75;

        svg {
            margin-right: 6px;
        }
    }
}

// Blurred full-width backdrop with the artwork also shown as a 16:9 still beside the details.
.programmeBanner {
    position: relative;
    overflow: hidden;

    .bannerBackdrop {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        filter: blur(22px);
        transform: scale(1.12);
    }

    .programmeBannerContent {
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 24px;
        background-color: rgba(0, 0, 0, 0.55);
        // Over the artwork backdrop: fixed white, not the theme's text colour (dark in light mode).
        color: #fff;
    }

    .poster {
        flex: 0 0 280px;
        width: 280px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);

        @media (max-width: @mobile-breakpoint) {
            flex-basis: 130px;
            width: 130px;
        }
    }

    .programmeText {
        flex: 1;
        min-width: 0;
    }
}

.labelShort {
    display: none;
}

.subscribeRow {
    // Buttons keep their natural width; the gap is the same 10px between them in both directions.
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 14px;

    // Phone width: two columns share the full width; an odd button out spans the whole row.
    @media (max-width: 600px) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));

        .labelLong {
            display: none;
        }

        .labelShort {
            display: inline;
        }

        > .subscribeButton {
            padding: 9px 8px;
            font-size: 14px;
            text-align: center;

            &:last-child:nth-child(odd) {
                grid-column: 1 / -1;
            }
        }
    }
}

// Phones: poster beside the title and pills, then the synopsis and buttons across the full width,
// instead of everything squeezed into the narrow column right of the poster.
@media (max-width: @mobile-breakpoint) {
    .programmeBanner .programmeBannerContent {
        display: grid;
        grid-template-columns: 112px minmax(0, 1fr);
        gap: 12px;
        padding: 1rem;

        &:not(.hasPoster) {
            grid-template-columns: minmax(0, 1fr);
        }

        .poster {
            width: 112px;
            flex-basis: auto;
        }

        .programmeText {
            display: contents;
        }

        .programmeHead {
            min-width: 0;
        }

        h1 {
            font-size: 24px;
            margin-bottom: 8px;
        }

        .programmeMeta {
            margin-bottom: 0;
            gap: 6px;

            .pill.grey,
            .pill.channelPill {
                font-size: 13px;
            }
        }

        p,
        .subscribeRow {
            grid-column: 1 / -1;
            margin: 0;
        }

        p {
            font-size: 14px;
        }
    }
}

.subscribeButton {
    padding: 8px 16px;
    font-size: 15px;
    border-radius: 4px;
    border: 1px solid @settings-button-border-color;
    background-color: @settings-button-background-color;
    color: @primary-text-color;

    svg {
        margin-right: 6px;
    }

    &:hover:not(:disabled) {
        background-color: @settings-button-hover-background-color;
    }

    &.on {
        background-color: @brand-color;
        border-color: @brand-color;
        color: @on-brand-color;
    }

    // Same size as the buttons, but a status label rather than something to press.
    &.arrChip,
    &.arrChip:hover:not(:disabled) {
        background-color: @brand-color;
        border-color: @brand-color;
        color: @on-brand-color;
        cursor: default;
        user-select: none;
    }
}

.episodeThumb {
    cursor: pointer;
}

.seasonActions {
    display: flex;
    // Stretch (not centre) so the sort button is always exactly as tall as the download button.
    align-items: stretch;
    justify-content: flex-end;
    gap: 14px;
    margin-bottom: 4px;

    // Inside the pager's left-hand slot, beside the page controls.
    &.inline {
        margin-bottom: 0;
        gap: 6px;
    }

    @media (max-width: 600px) {
        justify-content: stretch;
        gap: 6px;

        .seasonDownload {
            flex: 1;
            padding: 9px 14px;
        }
    }

    .seasonSort {
        flex: 0 0 auto;
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }

        @media (max-width: 600px) {
            padding: 9px 14px;
        }
    }

    .loadingMore {
        color: @subtle-text-color;
        font-size: 14px;
    }

    .seasonDownload {
        padding: 6px 14px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover:not(:disabled) {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }
}

.seasonTabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 1rem;

    // Every tab the same size: "S2" (or an icon for Specials / Episodes), full name on hover.
    .seasonTab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 36px;
        padding: 0;
        font-weight: 600;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }

        &.active {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }
}

.episodeRow {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid @toolbar-background-color;

    .episodeThumbWrap {
        position: relative;
        flex: 0 0 240px;
        width: 240px;

        @media (max-width: @mobile-breakpoint) {
            flex-basis: 200px;
            width: 200px;
        }

        // Phones: the thumbnail runs the full width above the text.
        @media (max-width: 600px) {
            flex-basis: auto;
            width: 100%;
        }
    }

    img,
    .episodeNoThumb {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background-color: @nav-background-color;
    }

    @media (max-width: 600px) {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
    }

    // Radio artwork is square: shown whole in the 16:9 box, over a blurred copy of itself (see .radioArtBox in global.less).
    .episodeThumbWrap.radioArt {
        border-radius: 4px;

        img {
            position: relative;
            object-fit: contain;
            background-color: transparent;
        }
    }

    .episodeNoThumb {
        display: flex;
        align-items: center;
        justify-content: center;
        color: @subtle-text-color;
    }

    .episodeInfo {
        flex: 1;
        min-width: 0;

        .episodeTitle {
            font-size: 16px;
        }

        .episodeLabel {
            display: block;
            color: @subtle-text-color;
            font-size: 12px;
        }

        .descriptionToggle {
            display: inline-block;
            margin-top: 2px;
            font-size: 12px;
            color: @brand-color;
        }

        .episodeDescription.clamped,
        .episodeDescription.open {
            cursor: pointer;
        }

        .episodeDescription.open {
            display: block;
            overflow: visible;
            -webkit-line-clamp: unset;
            line-clamp: unset;
        }

        .episodeDescription {
            margin-top: 4px;
            font-size: 13px;
            color: @table-text-color;
            line-height: 1.35;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .episodeDetails {
            margin-top: 4px;
            font-size: 12px;
            color: @subtle-text-color;

            span {
                margin-right: 12px;
            }
        }
    }

    // Fixed dark chip like the Subscriptions page's counts, as it sits on artwork.
    .onDiskBadge {
        position: absolute;
        top: 6px;
        left: 6px;
        padding: 2px 6px;
        border-radius: 10px;
        background-color: rgba(0, 0, 0, 0.75);
        color: #fff;
        font-size: 12px;
        line-height: 1.4;
    }

    // Same look as a programme card: bottom right, the subtitles icon in the corner; the buttons show on hover.
    .thumbBadges {
        position: absolute;
        bottom: 6px;
        right: 6px;
    }

    .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        border-radius: 4px;
        background-color: rgba(0, 0, 0, 0.55);
        opacity: 0;
        transition: opacity 150ms;
        // Only the buttons catch clicks; the rest of the thumbnail still opens the episode popup.
        pointer-events: none;

        button {
            pointer-events: auto;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 1px solid @settings-button-border-color;
            background-color: @settings-button-background-color;
            color: @primary-text-color;

            &:hover {
                background-color: @brand-color;
                border-color: @brand-color;
                color: @on-brand-color;
            }
        }
    }

    .episodeThumbWrap:hover .overlay,
    .episodeThumbWrap:focus-within .overlay {
        opacity: 1;
    }

    // Touch devices have no hover, so keep the buttons reachable, with the badges above them.
    @media (hover: none) {
        .overlay {
            opacity: 1;
            align-items: flex-end;
            justify-content: flex-end;
            padding: 6px;
            background: none;

            button {
                width: 34px;
                height: 34px;
                opacity: 0.9;
            }
        }

        .thumbBadges {
            bottom: 46px;
        }

        // With badges switched on they keep the bottom right and the buttons go top left.
        .episodeThumbWrap.badgesOn {
            .overlay {
                align-items: flex-start;
                justify-content: flex-start;
            }

            .thumbBadges {
                bottom: 6px;
            }
        }
    }
}
</style>
