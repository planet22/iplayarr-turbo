<template>
    <div class="inner-content statsPage">
        <PageHeader title="Statistics" icon="chart-bar" />
        <SettingsPageToolbar
            :icons="['filter']" :filter-enabled="range != 'All'" :filter-options="availableRanges"
            :selected-filter="range" @select-filter="selectRange" />
        <PageHeader title="Server" />
        <div class="statRow cacheRow">
            <div class="statCard cacheCard">
                <div class="cacheName">Uptime</div>
                <div class="cacheFigures uptimeFigures">
                    <div class="statBody">
                        <span class="statLabel">Running for</span>
                        <span class="statValue">{{ uptimeLoaded ? msToTime(uptime.uptime) : '-' }}</span>
                    </div>
                </div>
            </div>
        </div>

        <PageHeader title="Caches">
            <CacheListControls v-model:sort-by="sortBy" v-model:order="order" v-model:grouped="grouped" :options="STATS_SORTS" />
        </PageHeader>
        <div class="cacheGroups" :class="{ flat: !grouped }">
            <section v-for="section in sections" :key="section.key" class="cacheGroup" :data-group="section.key">
                <h3 v-if="section.label" class="cacheGroupHeading">
                    <span class="groupName">{{ section.label }}</span>
                    <span class="groupTotals">{{ summaryParts(section.totals).join(' · ') }}</span>
                </h3>
                <div class="statRow cacheRow">
                    <CacheStatCard
                        v-for="cache in section.caches" :key="cache.prefix" :cache="cache" :placeholder="!cachesLoaded"
                        :live="liveCaches[cache.prefix]" :pulse="pulses[cache.prefix]" :now="now" />
                </div>
            </section>
        </div>

        <PageHeader title="Activity">
            <SegmentedToggle
                v-model="excludeRss" label="RSS requests"
                :options="[{ value: false, label: 'RSS Included' }, { value: true, label: 'RSS Excluded' }]"
            />
        </PageHeader>
        <ErrorState v-if="summaryError && !summaryLoaded" message="Could not load the activity statistics." @retry="loadSummary" />
        <div class="statRow">
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'magnifying-glass']" />
                    <div class="statBody">
                        <span class="statLabel">Searches (Today)</span>
                        <span class="statValue" :title="exactToday('searches')">{{ todayCount('searches') }}</span>
                    </div>
                </div>
                <SparklineChart :data="summary.trends.searches" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'download']" />
                    <div class="statBody">
                        <span class="statLabel">Grabs (Today)</span>
                        <span class="statValue" :title="exactToday('grabs')">{{ todayCount('grabs') }}</span>
                    </div>
                </div>
                <SparklineChart :data="summary.trends.grabs" color="chart-6" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                    <div class="statBody">
                        <span class="statLabel">Failed Grabs (Today)</span>
                        <span class="statValue" :title="exactToday('failedGrabs')">{{ todayCount('failedGrabs') }}</span>
                    </div>
                </div>
                <SparklineChart :data="summary.trends.failedGrabs" color="danger-color" />
            </div>
        </div>
        <div class="chartRow">
            <div class="chartCard">
                <StackedBarChart title="Searches by source" :days="summary.activity.days" :series="summary.activity.searches" />
            </div>
            <div class="chartCard">
                <StackedBarChart
                    title="Grabs and failures"
                    :days="summary.activity.days"
                    :series="[
                        { ...summary.activity.grabs[0], color: 'chart-2' },
                        { ...summary.activity.grabs[1], color: 'danger-color' },
                    ]"
                />
            </div>
        </div>

        <PageHeader title="Search Breakdown" />
        <div class="chartRow">
            <div class="chartCard">
                <PieChart :data="summary.searchTerms" title="Search Terms" />
            </div>
            <div class="chartCard">
                <BarChart :data="summary.searchSources" title="Search Sources" />
            </div>
        </div>
        <PageHeader title="Grab Breakdown" />
        <div class="chartRow">
            <div class="chartCard">
                <PieChart :data="summary.grabTypes" title="Grab Types" />
            </div>
            <div class="chartCard">
                <BarChart :data="summary.grabSources" title="Grab Sources" />
            </div>
        </div>

        <PageHeader title="Top Content" />
        <div class="chartRow">
            <div class="chartCard">
                <h3 class="topContentHeading">Most Searched</h3>
                <TopContentList :items="summary.topSearched" />
            </div>
            <div class="chartCard">
                <h3 class="topContentHeading">Most Grabbed</h3>
                <TopContentList :items="summary.topGrabbed" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import BarChart from '@/components/charts/BarChart.vue';
import PieChart from '@/components/charts/PieChart.vue';
import SparklineChart from '@/components/charts/SparklineChart.vue';
import StackedBarChart from '@/components/charts/StackedBarChart.vue';
import CacheListControls from '@/components/common/CacheListControls.vue';
import CacheStatCard from '@/components/common/CacheStatCard.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SegmentedToggle from '@/components/common/SegmentedToggle.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TopContentList from '@/components/common/TopContentList.vue';
import { flashKind, formatCount, withLookups } from '@/lib/cacheActivity';
import { buildSections, STATS_SORTS, summaryParts } from '@/lib/cacheGroups';
import { ipFetch } from '@/lib/ipFetch';
import { useCacheListPrefs } from '@/lib/useCacheListPrefs';

const uptime = ref({ uptime: 0 });
const caches = ref([]);

// The three requests answer on their own. Until each has, its figures show dashes (and the cache tiles show in their
// usual groups, from the known list) so the page keeps its shape and fills in as the answers arrive.
const uptimeLoaded = ref(false);
const cachesLoaded = ref(false);
const summaryLoaded = ref(false);
const summaryError = ref(false);
// The real names come from a quick route that does no counting; only the figures are blank until the full list lands.
const cacheNames = ref([]);
const placeholderCaches = computed(() => cacheNames.value.map((info) => ({ ...info, count: 0, sizeBytes: 0 })));
const shownCaches = computed(() => (cachesLoaded.value ? caches.value : placeholderCaches.value));

const todayCount = (key) => (summaryLoaded.value ? formatCount(summary.value.today[key]) : '-');
const exactToday = (key) => (summaryLoaded.value ? summary.value.today[key].toLocaleString() : undefined);

// Cards are grouped by purpose and sorted inside each group (or one flat list); the choice is kept per browser.
// A card's key is its prefix, so a card that moves keeps its figures and its next flash.
const { sortBy, order, grouped } = useCacheListPrefs('stats', STATS_SORTS, { sortBy: 'busiest', grouped: true });

// Live cache figures: polled every few seconds (rates, last used, the 15 minute trend) and nudged by each batch of
// lookups the server pushes over the socket, which also makes a card's dot flash green (hit) or red (miss).
const socket = inject('socket');
const liveCaches = ref({});
const pulses = ref({});
const now = ref(Date.now());
const sections = computed(() => buildSections(shownCaches.value, { grouped: grouped.value, sortBy: sortBy.value, order: order.value, live: liveCaches.value }));
let pulseCount = 0;
const LIVE_POLL_MS = 5000;

async function loadActivity() {
    const { ok, data } = await ipFetch('json-api/maintenance/caches/activity');
    if (ok && data && typeof data === 'object') liveCaches.value = data;
}

function onCacheLookups(batch) {
    for (const [prefix, counts] of Object.entries(batch ?? {})) {
        const kind = flashKind(counts);
        if (!kind) continue;
        liveCaches.value = { ...liveCaches.value, [prefix]: withLookups(liveCaches.value[prefix], counts) };
        pulses.value = { ...pulses.value, [prefix]: { kind, n: ++pulseCount } };
    }
}

// Ask the server for the live lookups while this page is open (and again after a reconnect).
const askForLookups = () => socket?.value?.emit('watchCacheLookups');
watch(
    () => socket?.value,
    (current, previous) => {
        previous?.off('cacheLookups', onCacheLookups);
        previous?.off('connect', askForLookups);
        current?.on('cacheLookups', onCacheLookups);
        current?.on('connect', askForLookups);
        if (current?.connected) askForLookups();
    },
    { immediate: true }
);

// Worked out by the server (json-api/stats/summary); the page only displays it.
const emptySummary = {
    trends: { searches: [], grabs: [], failedGrabs: [] },
    today: { searches: 0, grabs: 0, failedGrabs: 0 },
    activity: { days: [], searches: [], grabs: [{ name: 'Grabbed', data: [] }, { name: 'Failed', data: [] }] },
    searchTerms: {},
    searchSources: {},
    grabTypes: {},
    grabSources: {},
    topSearched: [],
    topGrabbed: [],
};
const summary = ref(emptySummary);

const range = ref('7d');
const availableRanges = ref(['7d', '30d', '90d', 'All']);
const excludeRss = ref(true);

let refresher;
let ticker;
let activityPoller;
onMounted(() => {
    updateStats();
    loadActivity();
    ticker = setInterval(() => {
        uptime.value.uptime += 1000;
        now.value = Date.now();
    }, 1000);
    refresher = setInterval(updateStats, 180000);
    activityPoller = setInterval(loadActivity, LIVE_POLL_MS);
});
onBeforeUnmount(() => {
    clearInterval(ticker);
    clearInterval(refresher);
    clearInterval(activityPoller);
    socket?.value?.emit('unwatchCacheLookups');
    socket?.value?.off('cacheLookups', onCacheLookups);
    socket?.value?.off('connect', askForLookups);
});

// Only the newest answer is used, so a slow earlier request cannot overwrite a later one.
let latest = 0;
async function loadSummary() {
    const mine = ++latest;
    const { ok, data } = await ipFetch(`json-api/stats/summary?range=${encodeURIComponent(range.value)}&excludeRss=${excludeRss.value}`);
    if (ok && mine === latest) {
        summary.value = data;
        summaryLoaded.value = true;
        summaryError.value = false;
    } else if (!ok && mine === latest) {
        summaryError.value = true;
    }
}

async function loadUptime() {
    const { ok, data } = await ipFetch('json-api/stats/uptime');
    if (ok && data) {
        uptime.value = data;
        uptimeLoaded.value = true;
    }
}

async function loadNames() {
    const { ok, data } = await ipFetch('json-api/maintenance/caches/names');
    if (ok && Array.isArray(data) && !cachesLoaded.value) cacheNames.value = data;
}

async function loadCaches() {
    const { ok, data } = await ipFetch('json-api/maintenance/caches');
    if (ok && Array.isArray(data)) {
        caches.value = data;
        cachesLoaded.value = true;
    }
}

// Each part shows as soon as its own answer arrives; the slow summary no longer holds back the cache tiles.
const updateStats = () => Promise.all([loadSummary(), loadUptime(), loadNames(), loadCaches()]);

watch([range, excludeRss], loadSummary);

function msToTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
}

const selectRange = (option) => {
    range.value = option;
};

</script>

<style lang="less">
// Grouped: each group is a bordered box and the boxes flow into as many columns as fit, so a wide screen is used
// (columns pack the boxes top to bottom, so a short group does not leave a gap under a tall one). Flat: one plain list.
.cacheGroups:not(.flat) {
    columns: 540px;
    column-gap: 1rem;

    .cacheGroup {
        break-inside: avoid;
        box-sizing: border-box;
        border: 1px solid @input-border-color;
        border-radius: @radius-md;
        padding: @space-2 10px 10px;
        margin-bottom: 1rem;
    }
}

.cacheGroup {
    margin-bottom: 1.25rem;

    .statRow {
        margin-bottom: 0;
    }
}

.cacheGroups.flat {
    margin-bottom: 1.25rem;
}

.cacheGroupHeading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px @space-3;
    margin: 0 0 @space-2;
    font-size: 15px;
    font-weight: 600;
    color: @primary-text-color;

    .groupTotals {
        font-size: @font-size-sm;
        font-weight: 400;
        color: @subtle-text-color;
    }
}


.statRow {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 2rem;

    .statCard {
        flex: 1 1 220px;
        min-width: 220px;
        display: flex;
        align-items: center;
        gap: @space-4;
        background-color: @nav-active-background-color;
        border-radius: @radius-sm;
        box-shadow: 0 0 10px 1px @primary-box-shadow;
        padding: @space-4 20px;
        box-sizing: border-box;

        &.sparkline {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;

            .statCardHeader {
                display: flex;
                align-items: center;
                gap: @space-4;
            }
        }

        .statIcon {
            font-size: 26px;
            color: @brand-color;
            flex-shrink: 0;
        }

        .statBody {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .statLabel {
            font-size: @font-size-sm;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: @subtle-text-color;
        }

        .statValue {
            font-size: 28px;
            font-weight: 300;
            color: @primary-text-color;
            white-space: nowrap;
        }
    }
}

// A grid, so every tile is the same size and the columns line up row to row.
.statRow.cacheRow {
    display: grid;
    // As many columns as fit at a readable width, so figures never get squeezed at any screen size.
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.5rem;
}

.statRow .statCard.cacheCard {
    min-width: 0;
    flex-direction: column;
    align-items: stretch;
    gap: @space-1;
    padding: @space-2 @space-3;

    .cacheName {
        font-size: 13px;
        font-weight: 600;
        color: @primary-text-color;
        overflow-wrap: anywhere; // long names wrap rather than being cut off
    }

    // Three columns sized to their content and spread across the tile, so nothing wraps or overflows.
    .cacheFigures {
        display: grid;
        grid-template-columns: repeat(3, auto);
        justify-content: space-between;
        gap: @space-2;

        // Uptime has the one figure, so it takes the whole tile.
        &.uptimeFigures {
            grid-template-columns: 1fr;
        }

        .statLabel {
            font-size: 9px;
            white-space: nowrap;
        }

        .statValue {
            font-size: @font-size-md;
            font-weight: 400;
        }
    }
}

.chartRow {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1.5rem;
    margin-bottom: 2rem;

    .chartCard {
        flex: 1 1 300px; // base size, but flexible - wraps naturally regardless of row item count
        min-width: 300px;
        box-sizing: border-box;
        background-color: @nav-active-background-color;
        border-radius: @radius-sm;
        box-shadow: 0 0 10px 1px @primary-box-shadow;
        padding: @space-4;

        @media (max-width: @mobile-breakpoint) {
            max-width: 100%;
        }

        .topContentHeading {
            margin: 0 0 @space-3;
            font-size: 16px;
            font-weight: 400;
            color: @primary-text-color;
        }
    }
}

// Phones: lighter cards and smaller figures, so the numbers do not dominate the screen. Scoped to this page
// because the Watchdog page's own (global) .statRow rules would otherwise win on the shared class names.
@media (max-width: @mobile-breakpoint) {
    .statsPage {
        .statRow {
            gap: 0.6rem;
            margin-bottom: 1.25rem;

            &.cacheRow {
                gap: 0.4rem;
                grid-template-columns: 1fr;

                .statCard.cacheCard {
                    padding: 6px 10px;

                    .statValue {
                        font-size: 13px;
                    }
                }
            }

            .statCard {
                flex-basis: 100%;
                min-width: 0;
                gap: @space-3;
                padding: 10px 14px;

                &.sparkline {
                    gap: 6px;

                    .statCardHeader {
                        gap: @space-3;
                    }
                }

                .statIcon {
                    font-size: 20px;
                    width: 24px;
                }

                .statLabel {
                    font-size: 11px;
                }

                .statValue {
                    font-size: 20px;
                }
            }
        }

        .chartRow {
            gap: 0.75rem;
            margin-bottom: 1.25rem;

            .chartCard {
                flex-basis: 100%;
                min-width: 0;
                padding: @space-3;
            }
        }
    }
}
</style>
