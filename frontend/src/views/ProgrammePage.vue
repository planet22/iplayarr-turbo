<template>
    <LoadingIndicator v-if="loading" />
    <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
    <template v-else-if="programme">
        <div class="programmeBanner">
            <div class="bannerBackdrop" :style="bannerStyle" />
            <div class="programmeBannerContent">
                <img v-if="posterUrl" class="poster" :src="posterUrl" :alt="programme.title" />
                <div class="programmeText">
                <h1>{{ programme.title }}</h1>
                <div class="programmeMeta">
                    <span :class="['pill', 'grey']">
                        <font-awesome-icon :icon="['fas', 'tv']" />
                        {{ programme.kind === 'brand' ? 'Programme' : programme.kind === 'series' ? 'Series' : 'Episode' }}
                    </span>
                    <ChannelPill :channel="programme.channel">
                        <font-awesome-icon :icon="['fas', 'tower-broadcast']" />
                    </ChannelPill>
                    <span v-if="programme.category" :class="['pill', 'grey']">{{ programme.category }}</span>
                    <span :class="['pill', 'grey']">
                        <a :href="`https://www.bbc.co.uk/programmes/${programme.pid}`" target="_blank" rel="noopener noreferrer">
                            <font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" />Link
                        </a>
                    </span>
                </div>
                <p v-if="programme.synopsis">{{ programme.synopsis }}</p>
                <button
                    v-if="programme.kind !== 'episode' || subscription"
                    :class="['clickable', 'subscribeButton', subscription ? 'on' : '']" :disabled="subscribing"
                    @click="toggleSubscription"
                >
                    <font-awesome-icon :icon="['fas', subscribing ? 'circle-notch' : 'bell']" :spin="subscribing" />
                    {{ subscription ? 'Subscribed' : 'Subscribe' }}
                </button>
                </div>
            </div>
        </div>

        <div class="browsePage">
            <p v-if="programme.seasons.length === 0">No episodes are currently available.</p>
            <template v-else>
                <div v-if="programme.seasons.length > 1" class="seasonTabs">
                    <button
                        v-for="(season, index) in programme.seasons"
                        :key="index"
                        :class="['clickable', 'seasonTab', index === selected ? 'active' : '']"
                        @click="selectSeason(index)"
                    >
                        {{ seasonLabel(season) }}
                    </button>
                </div>
                <div class="seasonActions">
                    <span v-if="loadingMore" class="loadingMore">
                        <font-awesome-icon :icon="['fas', 'circle-notch']" spin />
                        Loading more episodes… ({{ loadedCount }} so far)
                    </span>
                    <button class="clickable seasonDownload" :disabled="downloadingSeason || loadingMore" @click="downloadSeason">
                        <font-awesome-icon :icon="['fas', downloadingSeason ? 'circle-notch' : 'cloud-download']" :spin="downloadingSeason" />
                        Download {{ programme.seasons.length > 1 ? seasonLabel(programme.seasons[selected]) : 'all' }}
                        ({{ episodes.length }})
                    </button>
                </div>
                <TablePagination v-model="episodePage" v-model:page-size="episodePageSize" :total="episodes.length" />
                <div class="episodeList">
                    <div v-for="episode in pagedEpisodes" :key="episode.pid" class="episodeRow">
                        <img v-if="episode.thumbnail" :src="getThumbnailUrl(episode.thumbnail)" :alt="episode.title" loading="lazy" />
                        <div v-else class="episodeNoThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                        <div class="episodeInfo">
                            <div class="episodeTitle">
                                <span v-if="getSeriesEpisodeLabel(episode)" class="episodeLabel">{{ getSeriesEpisodeLabel(episode) }}</span>
                                {{ episode.episodeTitle || episode.title }}
                            </div>
                            <div v-if="episode.description" class="episodeDescription">{{ episode.description }}</div>
                            <div class="episodeDetails">
                                <span v-if="episode.runtime">{{ Math.round(episode.runtime) }} min</span>
                                <span v-if="episode.firstBroadcast">{{ formatDate(episode.firstBroadcast) }}</span>
                            </div>
                        </div>
                        <div class="episodeActions">
                            <button v-if="canPlay" class="clickable" title="Play Video" @click="play(episode)">
                                <font-awesome-icon :icon="['fas', 'play']" />
                            </button>
                            <button class="clickable" title="Download" @click="download(episode)">
                                <font-awesome-icon :icon="['fas', 'cloud-download']" />
                            </button>
                        </div>
                    </div>
                </div>
                <TablePagination v-model="episodePage" v-model:page-size="episodePageSize" :total="episodes.length" />
            </template>
        </div>
    </template>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ChannelPill from '@/components/common/ChannelPill.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { browseFetch, toDownloadResult } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { useSubscriptions } from '@/lib/subscriptions';
import { useBrowseActions } from '@/lib/useBrowseActions';
import { usePagination } from '@/lib/usePagination';
import { buildDownloadQuery, formatDate, getSeriesEpisodeLabel, getThumbnailUrl } from '@/lib/utils';

const route = useRoute();
const router = useRouter();
const programme = ref(null);
const loading = ref(true);
const error = ref(null);
const selected = ref(0);
const downloadingSeason = ref(false);

const { canPlay, play, download } = useBrowseActions();

// Subscribing is per show: after the server climbs an episode to its brand, programme.pid is the
// brand pid that subscriptions are keyed by.
const { load: loadSubscriptions, findByPid, subscribe, unsubscribe } = useSubscriptions();
const subscribing = ref(false);
const subscription = computed(() => (programme.value ? findByPid(programme.value.pid) : undefined));

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
loadSubscriptions();

// Newest first: by first broadcast when both have one, otherwise by episode number.
const newestFirst = (a, b) => {
    const ta = Date.parse(a.firstBroadcast);
    const tb = Date.parse(b.firstBroadcast);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return (b.episode ?? -1) - (a.episode ?? -1);
};

const episodes = computed(() => [...(programme.value?.seasons[selected.value]?.episodes ?? [])].sort(newestFirst));

const {
    page: episodePage, pageSize: episodePageSize, pagedItems: pagedEpisodes,
} = usePagination(episodes);
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

const posterUrl = computed(() => getThumbnailUrl(programme.value?.thumbnail));

const bannerStyle = computed(() => {
    const url = getThumbnailUrl(programme.value?.thumbnail);
    return url ? { 'background-image': `url(${url})` } : {};
});

const seasonLabel = ({ series }) => (series == null ? 'Episodes' : series === 0 ? 'Specials' : `Series ${series}`);

// Queue every episode of the selected series, one request at a time like the Search page's bulk
// download, then report any that were refused instead of failing silently.
const downloadSeason = async () => {
    const batch = episodes.value;
    if (batch.length === 0) return;
    const label = programme.value.seasons.length > 1 ? seasonLabel(programme.value.seasons[selected.value]) : programme.value.title;
    if (!(await dialogService.confirm('Download', `Download ${batch.length} episodes of ${label}?`))) return;

    downloadingSeason.value = true;
    const failed = [];
    for (const episode of batch) {
        try {
            const response = await ipFetch(`json-api/download?${buildDownloadQuery(toDownloadResult(episode))}`);
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

watch(
    () => route.params.pid,
    async (pid) => {
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
</script>

<style lang="less" scoped>
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

// Blurred full-width backdrop with the artwork also shown as a poster beside the details.
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
    }

    .poster {
        flex: 0 0 150px;
        width: 150px;
        aspect-ratio: 2 / 3;
        object-fit: cover;
        border-radius: 4px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);

        @media (max-width: @mobile-breakpoint) {
            flex-basis: 90px;
            width: 90px;
        }
    }

    .programmeText {
        flex: 1;
        min-width: 0;
    }
}

.subscribeButton {
    margin-top: 14px;
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
    }
}

.seasonActions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    margin-bottom: 4px;

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
        }
    }
}

.seasonTabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 1rem;

    .seasonTab {
        padding: 6px 14px;
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
        }
    }
}

.episodeRow {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid @toolbar-background-color;

    img,
    .episodeNoThumb {
        flex: 0 0 160px;
        width: 160px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background-color: @nav-background-color;

        @media (max-width: @mobile-breakpoint) {
            flex-basis: 100px;
            width: 100px;
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

    .episodeActions {
        display: flex;
        flex-shrink: 0;
        gap: 8px;

        @media (max-width: @mobile-breakpoint) {
            flex-direction: column;
        }

        button {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 1px solid @settings-button-border-color;
            background-color: @settings-button-background-color;
            color: @primary-text-color;

            &:hover {
                background-color: @brand-color;
                border-color: @brand-color;
            }
        }
    }
}
</style>
