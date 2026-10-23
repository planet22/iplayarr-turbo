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
                <img v-if="posterUrl" class="poster" :src="posterUrl" :alt="programme.title" @error="hideBrokenImage" />
                <div v-else-if="isMissing('thumbnail')" class="poster missing" title="Artwork unavailable" role="img" aria-label="Artwork unavailable">
                    <font-awesome-icon :icon="['fas', 'image']" />
                </div>
                <div class="programmeText">
                <div class="programmeHead">
                <h1>{{ programme.title }}</h1>
                <div class="programmeMeta">
                    <span :class="['pill', 'grey']">
                        <font-awesome-icon :icon="['fas', 'tv']" />
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
                    <button
                        :class="['clickable', 'subscribeButton', subscription ? 'on' : '']" :disabled="subscribing"
                        @click="toggleSubscription"
                    >
                        <font-awesome-icon :icon="['fas', 'bell']" />
                        {{ subscription ? 'Subscribed' : 'Subscribe' }}
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
                        v-if="!entry?.arr"
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
                        class="clickable subscribeButton"
                        :disabled="subscribing"
                        :title="subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr'"
                        @click="toggleArrWithBusy"
                    >
                        <font-awesome-icon :icon="['fas', subscription.arr ? 'link-slash' : 'link']" />
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
                        <font-awesome-icon :icon="['fas', 'link-slash']" />
                        Remove
                    </button>
                </div>
                </div>
            </div>
        </div>

        <div class="browsePage">
            <EmptyState v-if="programme.seasons.length === 0" icon="film" title="No episodes are currently available" hint="They may not be on iPlayer right now." />
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
                    <div v-for="episode in pagedEpisodes" :key="episode.pid" class="episodeRow">
                        <!-- The thumbnail opens the same episode popup as the download button; play and download sit on it like on a card. -->
                        <div class="episodeThumbWrap">
                            <img
                                v-if="episode.thumbnail" class="episodeThumb" :src="getThumbnailUrl(episode.thumbnail, true)" :alt="episode.title"
                                loading="lazy" role="button" tabindex="0" @error="hideBrokenImage" @click="download(episode)" @keydown.enter="download(episode)"
                            />
                            <div v-else class="episodeNoThumb episodeThumb" role="button" tabindex="0" @click="download(episode)" @keydown.enter="download(episode)">
                                <font-awesome-icon :icon="['fas', 'tv']" />
                            </div>
                            <div class="overlay">
                                <button v-if="canPlay" class="clickable" title="Play Video" @click="play(episode)">
                                    <font-awesome-icon :icon="['fas', 'play']" />
                                </button>
                                <button class="clickable" title="Download" @click="download(episode)">
                                    <font-awesome-icon :icon="['fas', 'cloud-download']" />
                                </button>
                            </div>
                            <QualityBadges :item="episode" class="thumbBadges" />
                        </div>
                        <div class="episodeInfo">
                            <div class="episodeTitle">
                                <span v-if="getSeriesEpisodeLabel(episode)" class="episodeLabel">{{ getSeriesEpisodeLabel(episode) }}</span>
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
import { computed, inject, reactive, ref, watch } from 'vue';
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
import { ipFetch } from '@/lib/ipFetch';
import { requestFromArr, useArrAppNames } from '@/lib/subscriptionArr';
import { useSubscriptions } from '@/lib/subscriptions';
import { useBrowseActions } from '@/lib/useBrowseActions';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { buildDownloadQuery, formatDate, getSeriesEpisodeLabel, getThumbnailUrl, hideBrokenImage, roundUpMinutes } from '@/lib/utils';

const route = useRoute();
const router = useRouter();
const programme = ref(null);
const loading = ref(true);
const error = ref(null);
const selected = ref(0);
const downloadingSeason = ref(false);

const { canPlay, play, download } = useBrowseActions();
const globalSettings = inject('globalSettings', ref({}));

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
    selected.value = index;
    episodePage.value = 1;
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
    // What it will produce, and the combined size of the episodes whose runtime is known.
    const sizes = batch.map((episode) => estimateSizeMb(globalSettings.value, { runtimeMinutes: episode.runtime }));
    const totalMb = sizes.reduce((sum, size) => sum + (size ?? 0), 0);
    const media = await dialogService.confirmDownload(`Download ${batch.length} episodes of ${label}?`, {
        count: batch.length,
        totalMb: sizes.some((size) => size === undefined) ? undefined : totalMb,
    });
    if (!media) return;
    // Only sent when it differs from the setting.
    const override = media === defaultMediaMode(globalSettings.value) ? undefined : media;

    downloadingSeason.value = true;
    const failed = [];
    for (const episode of batch) {
        try {
            const response = await ipFetch(`json-api/download?${buildDownloadQuery({ ...toDownloadResult(episode), media: override })}`);
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
    while (hasMore && route.params.pid === pid) {
        let next;
        try {
            next = await browseFetch(`programme/${encodeURIComponent(pid)}?page=${page + 1}`);
        } catch {
            return; // keep what has loaded rather than replacing the page with an error
        }
        if (route.params.pid !== pid) return;
        const selectedSeries = programme.value.seasons[selected.value]?.series;
        const seasons = mergeSeasons(programme.value.seasons, next.seasons);
        programme.value = { ...programme.value, seasons };
        selected.value = Math.max(0, seasons.findIndex(({ series }) => series === selectedSeries));
        ({ page, hasMore } = next);
    }
};

// Bumped by Try again to load the same programme once more.
const reloadKey = ref(0);
const reload = () => reloadKey.value++;

watch(
    () => [route.params.pid, reloadKey.value],
    async ([pid]) => {
        if (!pid) return;
        loading.value = true;
        loadingMore.value = false;
        error.value = null;
        selected.value = 0;
        try {
            const first = await browseFetch(`programme/${encodeURIComponent(pid)}`);
            if (route.params.pid !== pid) return;
            programme.value = first;
            // Land on the newest numbered series rather than Specials (series 0), which sorts first.
            const { seasons } = first;
            const latest = seasons.reduce((best, { series }, i) => (series > (seasons[best].series ?? -1) ? i : best), 0);
            selected.value = latest;
            loading.value = false;
            await loadRemainingPages(pid, first);
        } catch (e) {
            if (route.params.pid === pid) error.value = e.message;
        } finally {
            if (route.params.pid === pid) {
                loading.value = false;
                loadingMore.value = false;
            }
        }
    },
    { immediate: true }
);

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
    }
}
</style>
