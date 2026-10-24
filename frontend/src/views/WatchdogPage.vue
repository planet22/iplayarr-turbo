<template>
    <div class="inner-content">
        <PageHeader title="STRM Watchdog" />
        <SettingsPageToolbar
            :icons="['run', 'refresh']"
            :running="live.running" :run-disabled="live.running ? stopping : !canRun"
            :stop-label="stopping ? 'Stopping…' : 'Stop'"
            :refreshing="refreshing || listing"
            :refresh-disabled="live.running || refreshing || listing" :refresh-label="refreshing || listing ? 'Refreshing…' : 'Refresh Links'"
            refresh-title="Re-list links from the sources and update the counts, without checking them against BBC"
            @run="runNow" @stop="stopRun" @refresh="refreshCounts"
        />
        <InfoBar v-if="!status.enabled">
            The STRM Watchdog is disabled. Enable it under Settings → Streaming.
        </InfoBar>
        <InfoBar v-if="runError">{{ runError }}</InfoBar>
        <InfoBar v-if="live.notice">{{ live.notice }}</InfoBar>
        <InfoBar v-for="warning in live.warnings || []" :key="warning" clazz="warning">{{ warning }}</InfoBar>

        <div class="statRow">
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'link']" />
                <div class="statBody">
                    <span class="statLabel">Links Tracked</span>
                    <div class="valueRow">
                        <span class="statValue">{{ tracked.total }}<span class="dedupMark" title="After de-duplicating links across libraries">*</span></span>
                        <TypeCounts :counts="tracked.types" />
                    </div>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'circle-check']" />
                <div class="statBody">
                    <span class="statLabel">Valid</span>
                    <div class="valueRow">
                        <span class="statValue">{{ validCount }}<span class="dedupMark" title="After de-duplicating links across libraries">*</span></span>
                        <TypeCounts :counts="validTypes" />
                    </div>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                <div class="statBody">
                    <span class="statLabel">Invalid</span>
                    <div class="valueRow">
                        <span class="statValue">{{ invalidCount }}<span class="dedupMark" title="After de-duplicating links across libraries">*</span></span>
                        <TypeCounts :counts="invalidTypes" />
                    </div>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'clock']" />
                <div class="statBody">
                    <span class="statLabel">Last Run</span>
                    <span class="statValue small">{{ lastRunLabel }}</span>
                    <span class="sourceBreakdown">
                        <span v-if="lastRun">
                            <font-awesome-icon :icon="['fas', 'stopwatch']" fixed-width />
                            {{ live.running ? 'Running' : 'Took' }} {{ formatDuration(lastRunDuration) }}
                        </span>
                    </span>
                </div>
            </div>
        </div>

        <div class="statRow">
            <div class="statCard progressCard">
                <div class="progressHeader">
                    <span class="statLabel">{{ live.running ? 'Checking' : listing ? 'Refreshing' : 'Idle' }}</span>
                    <span v-if="listing" class="progressText">{{ live.collecting.done }} / {{ live.collecting.total }}</span>
                    <span v-else class="progressText">{{ live.checked }} / {{ live.total }}</span>
                </div>
                <div class="progressTrack">
                    <div class="progressFill" :style="{ width: progressPercent + '%' }" />
                </div>
                <div class="progressDetail">
                    <template v-if="live.running && live.currentPid">
                        Checking <router-link :to="`/browse/programme/${live.currentPid}`">{{ live.currentPid }}</router-link>
                    </template>
                    <template v-else-if="live.collecting">
                        Collecting from {{ live.collecting.name }}<template v-if="live.collecting.total">{{ ' ' }}{{ live.collecting.done }} / {{ live.collecting.total }}</template>
                    </template>
                    <template v-else-if="live.running">Collecting from sources...</template>
                    <template v-else>{{ live.stopped ? 'Last run was stopped.' : 'Nothing running.' }}</template>
                    <span class="liveCounts">
                        {{ live.ok }} ok · {{ live.invalid }} invalid · {{ live.inconclusive }} inconclusive
                    </span>
                </div>
            </div>
        </div>

        <p class="dedupNote">* Totals are after de-duplicating libraries; a link listed by several sources counts under each in the per-source counts.</p>

        <legend>Statistics</legend>
        <div class="statRow">
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'magnifying-glass']" />
                    <div class="statBody">
                        <span class="statLabel">Checked (Last Run)</span>
                        <span class="statValue">{{ lastRun?.checked ?? 0 }}</span>
                    </div>
                </div>
                <SparklineChart :data="runs.map((r) => r.checked)" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                    <div class="statBody">
                        <span class="statLabel">Failed (Last Run)</span>
                        <span class="statValue">{{ lastRun?.invalid ?? 0 }}</span>
                    </div>
                </div>
                <SparklineChart :data="runs.map((r) => r.invalid)" color="danger-color" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'percent']" />
                    <div class="statBody">
                        <span class="statLabel">Failure Rate (Last Run)</span>
                        <span class="statValue">{{ failureRate(lastRun).toFixed(2) }}%</span>
                    </div>
                </div>
                <SparklineChart :data="runs.map(failureRate)" color="chart-6" />
            </div>
        </div>
        <div class="chartRow">
            <div class="chartCard">
                <LineChart
                    title="Checked vs Failed"
                    :local-time="true"
                    :window-minutes="live.running ? 2 : 0"
                    :series="[
                        { name: 'Checked', data: checkedSeries, color: 'chart-1' },
                        { name: 'Failed', data: failedSeries, color: 'danger-color' },
                    ]"
                />
            </div>
        </div>

        <PageHeader title="Library Access" />
        <SettingsPageToolbar
            :icons="['refresh']" :refresh-label="checkingAccess ? 'Checking…' : 'Check Access'"
            :refreshing="checkingAccess" :refresh-disabled="checkingAccess" @refresh="checkAccess"
        />
        <InfoBar v-if="accessError">{{ accessError }}</InfoBar>
        <p v-if="!access" class="empty">
            Checks that this container can read the .strm files Sonarr/Radarr and Jellyfin report, using the current Path Mapping.
        </p>
        <div v-else class="accessResults">
            <p v-if="access.checkedAt" class="detail">Last checked {{ formatRelativeTime(Date.parse(access.checkedAt)) }}</p>
            <div v-for="(info, source) in access.sources" :key="source" class="accessRow">
                <span :class="['pill', accessOk(info) ? 'success' : 'error']">{{ info.readable }} / {{ info.total }}</span>
                <span>{{ sourceLabels[source] }} iPlayarr .strm files readable</span>
                <span v-if="info.ignored || info.unverified" class="detail">
                    ({{ info.ignored }} other ignored<template v-if="info.unverified">, {{ info.unverified }} unverified</template>)
                </span>
                <span v-if="info.error" class="detail">{{ info.error }}</span>
                <span v-else-if="info.unreadableExamples.length" class="detail">
                    e.g. {{ info.unreadableExamples[0] }}
                </span>
            </div>
            <div v-if="access.unique" class="accessRow">
                <span :class="['pill', access.unique.readable === access.unique.total ? 'success' : 'error']">
                    {{ access.unique.readable }} / {{ access.unique.total }}
                </span>
                <span>unique iPlayarr .strm files readable</span>
                <span class="detail">
                    ({{ access.unique.both }} in Sonarr/Radarr + Jellyfin, {{ access.unique.arrOnly }} Sonarr/Radarr only,
                    {{ access.unique.jellyfinOnly }} Jellyfin only)
                </span>
            </div>
            <p v-if="!Object.keys(access.sources).length" class="empty">
                No Sonarr/Radarr or Jellyfin configured - add one under Apps.
            </p>
            <div v-if="access.suggestion" class="accessRow">
                <span class="pill primary">Suggested mapping</span>
                <code>{{ access.suggestion.from }}={{ access.suggestion.to }}</code>
                <span class="detail">
                    fixes {{ access.suggestion.matched }} of {{ access.suggestion.tested }} sampled paths
                </span>
                <button class="rssToggle clickable" @click="applyMapping(`${access.suggestion.from}=${access.suggestion.to}`)">
                    Apply
                </button>
            </div>
            <p v-else-if="hasUnreadable" class="empty">
                Those files weren't found anywhere in this container. Mount your library into the iPlayarr container
                (e.g. your data share), then check again.
            </p>
            <p v-if="access.pathMap" class="detail">Current Path Mapping: {{ access.pathMap }}</p>
        </div>

        <PageHeader title="Links" />
        <SettingsPageToolbar
            :icons="['delete']" delete-label="Clear links" :delete-disabled="live.running || !sortedItems.length"
            @delete-queue-item="clearItems"
        />
        <p v-if="!sortedItems.length" class="empty">No links have been checked yet.</p>
        <template v-else>
        <div class="viewToggleRow">
            <ViewToggle :model-value="viewMode" :modes="['table', 'cards']" @update:model-value="setViewMode" />
        </div>
        <Pagination v-model="linkPage" v-model:page-size="linkPageSize" :total="sortedItems.length" />
        <div v-if="cardView" class="cardList">
            <DataCard v-for="item in pagedItems" :key="item.pid">
                <template #thumb>
                    <img
                        v-if="getProgrammeThumbnailUrl(item.pid)"
                        class="clickable"
                        :src="getProgrammeThumbnailUrl(item.pid)"
                        @click="router.push(`/browse/programme/${item.pid}`)"
                        @error="hideBrokenImage"
                    />
                    <div v-else class="thumbnail-placeholder"></div>
                </template>
                <template #title>
                    <router-link :to="`/browse/programme/${item.pid}`">{{ details[item.pid]?.title ?? item.pid }}</router-link>
                </template>
                <template v-if="details[item.pid]?.title || getSeriesEpisodeLabel(details[item.pid])" #subtitle>
                    {{ [details[item.pid]?.title ? item.pid : '', getSeriesEpisodeLabel(details[item.pid])].filter(Boolean).join(' · ') }}
                </template>
                <template #chips>
                    <span :class="['pill', item.status == 'invalid' ? 'error' : 'success']">
                        {{ item.status == 'invalid' ? 'Invalid' : 'Valid' }}
                    </span>
                    <span v-if="item.status == 'ok' && item.failCount" class="pill grey">1 strike</span>
                    <span v-if="(item.sourceNames || item.sources || []).length" class="linkMeta">
                        {{ (item.sourceNames || (item.sources || []).map((s) => sourceLabels[s] ?? s)).join(', ') }}
                    </span>
                    <span class="linkMeta" title="Last checked">
                        <font-awesome-icon :icon="['fas', 'clock']" />{{ formatRelativeTime(Date.parse(item.lastChecked), undefined, true) }}
                    </span>
                    <span v-if="(item.actions || []).length" class="linkMeta">{{ item.actions.join(', ') }}</span>
                </template>
                <template v-if="item.status == 'invalid' && (item.message || (item.files || []).length)">
                    {{ item.message || (item.files || []).join(', ') }}
                </template>
            </DataCard>
        </div>
        <table v-else class="dataTable">
            <thead>
                <tr>
                    <th>Programme</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Last Checked</th>
                    <th>Action</th>
                    <th>File / Detail</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="item in pagedItems" :key="item.pid">
                    <td class="text"><router-link :to="`/browse/programme/${item.pid}`">{{ item.pid }}</router-link></td>
                    <td data-title="Status">
                        <span :class="['pill', item.status == 'invalid' ? 'error' : 'success']">
                            {{ item.status == 'invalid' ? 'Invalid' : 'Valid' }}
                        </span>
                        <span v-if="item.status == 'ok' && item.failCount" class="pill grey">1 strike</span>
                    </td>
                    <td data-title="Source">
                        {{ (item.sourceNames || (item.sources || []).map((s) => sourceLabels[s] ?? s)).join(', ') || '—' }}
                    </td>
                    <td data-title="Checked">{{ formatRelativeTime(Date.parse(item.lastChecked)) }}</td>
                    <td data-title="Action">{{ (item.actions || []).join(', ') }}</td>
                    <td :class="['detail', item.status == 'ok' ? 'hide-mobile' : '']">{{ item.message || (item.files || []).join(', ') }}</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="linkPage" v-model:page-size="linkPageSize" :total="sortedItems.length" />
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import LineChart from '@/components/charts/LineChart.vue';
import SparklineChart from '@/components/charts/SparklineChart.vue';
import DataCard from '@/components/common/DataCard.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import Pagination from '@/components/common/TablePagination.vue';
import ViewToggle from '@/components/common/ViewToggle.vue';
import TypeCounts from '@/components/watchdog/TypeCounts.vue';
import { details, loadDetails } from '@/lib/detailsCache';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useViewMode } from '@/lib/useViewMode';
import { formatRelativeTime, getProgrammeThumbnailUrl, getSeriesEpisodeLabel, hideBrokenImage } from '@/lib/utils';

const socket = inject('socket');
const router = useRouter();

// Cards on phones (six columns, long paths), table on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.watchdogViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');

const status = ref({
    enabled: false,
    live: { running: false, total: 0, checked: 0, ok: 0, invalid: 0, inconclusive: 0 },
    items: [],
    runs: [],
});
const runError = ref('');
const stopping = ref(false);
// The last check is saved by the server (shown on load); a fresh check in this tab takes over from it.
const accessLocal = ref(null);
const access = computed(() => accessLocal.value ?? status.value.libraryAccess ?? null);
const refreshing = ref(false);
const accessError = ref('');
const checkingAccess = ref(false);
// Ticks once a second so an in-progress run's elapsed time keeps counting.
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);

const live = computed(() => status.value.live);
// Saved runs plus the in-progress one, so the sparklines and charts move while a run is going.
const runs = computed(() => {
    const saved = status.value.runs;
    if (!live.value.running) return saved;
    const { startedAt, checked, ok, invalid, inconclusive } = live.value;
    return [...saved, { startedAt, finishedAt: new Date(now.value).toISOString(), checked, ok, invalid, inconclusive }];
});
const lastRun = computed(() => runs.value[runs.value.length - 1]);

const validCount = computed(() => status.value.items.filter(({ status }) => status == 'ok').length);
const invalidCount = computed(() => status.value.items.filter(({ status }) => status == 'invalid').length);
const sortedItems = computed(() =>
    [...status.value.items].sort(
        (a, b) => (b.status == 'invalid') - (a.status == 'invalid') || Date.parse(b.lastChecked) - Date.parse(a.lastChecked)
    )
);
const {
    page: linkPage,
    pageSize: linkPageSize,
    pagedItems,
} = usePagination(sortedItems);

// Titles and posters for the card view, only for the page on screen.
watch(
    [pagedItems, cardView],
    () => cardView.value && pagedItems.value.forEach(({ pid }) => loadDetails(pid)),
    { immediate: true }
);
const sourceLabels = { history: 'iPlayarr', arr: 'Sonarr/Radarr', jellyfin: 'Jellyfin' };
// What kind of source listed an item. Older stored items predate `types`, so fall back to their source.
const typesOf = (item) =>
    item.types ?? (item.sources || []).map((source) => ({ history: 'HISTORY', arr: 'SONARR', jellyfin: 'JELLYFIN' })[source]);
const countTypes = (items) =>
    items.reduce((acc, item) => {
        typesOf(item).forEach((type) => (acc[type] = (acc[type] || 0) + 1));
        return acc;
    }, {});
const validTypes = computed(() => countTypes(status.value.items.filter(({ status }) => status == 'ok')));
const invalidTypes = computed(() => countTypes(status.value.items.filter(({ status }) => status == 'invalid')));

// Fixed per run (computed server-side when the run starts) so it doesn't climb as links are checked.
const tracked = computed(() => ({
    total: status.value.tracked?.total ?? status.value.items.length,
    types: status.value.tracked?.types ?? countTypes(status.value.items),
}));
// Refresh Links lists the sources without a run, so the card shows that listing's progress instead.
const listing = computed(() => !live.value.running && !!live.value.collecting);
const progressPercent = computed(() => {
    const { done, total } = listing.value ? live.value.collecting : { done: live.value.checked, total: live.value.total };
    return total ? Math.round((done / total) * 100) : 0;
});
const canRun = computed(() => status.value.enabled && !live.value.running);
const lastRunDuration = computed(() =>
    lastRun.value ? Date.parse(lastRun.value.finishedAt) - Date.parse(lastRun.value.startedAt) : 0
);

function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h) return `${h}h ${m}m ${sec}s`;
    return m ? `${m}m ${sec}s` : `${sec}s`;
}

const lastRunLabel = computed(() => (lastRun.value ? formatRelativeTime(Date.parse(lastRun.value.finishedAt)) : 'Never'));

// Percentage to two decimal places (a handful of failures in hundreds of links is well under 1%).
const failureRate = (run) => (run && run.checked ? Math.round((run.invalid / run.checked) * 10000) / 100 : 0);
// Past runs (one point each, when they finished) followed by the current run's progress, sampled by the
// server every few seconds, so the chart moves while a run is going. Once it finishes its saved point
// replaces the ramp (which starts at 0 and would otherwise show as a dip at the end of the line).
const seriesOf = (field) =>
    Object.fromEntries([
        ...status.value.runs.map((run) => [run.finishedAt, run[field]]),
        ...(live.value.running ? live.value.samples ?? [] : []).map((sample) => [new Date(sample.t).toISOString(), sample[field]]),
    ]);
const checkedSeries = computed(() => seriesOf('checked'));
const failedSeries = computed(() => seriesOf('invalid'));

const onStatus = (data) => {
    status.value = data;
    if (!data.live.running) stopping.value = false;
};

async function clearItems() {
    if (!(await dialogService.confirm('Clear Table', 'Clear the list of checked links? They will be listed again on the next run.', undefined, { danger: true, confirmLabel: 'Clear' }))) return;
    const { ok, data } = await ipFetch('json-api/watchdog/items', 'DELETE');
    if (!ok) runError.value = data?.message ?? 'Could not clear the table';
}

async function stopRun() {
    stopping.value = true;
    const { ok, data } = await ipFetch('json-api/watchdog/stop', 'POST');
    if (!ok) {
        runError.value = data?.message ?? 'Could not stop the watchdog';
        stopping.value = false;
    }
}

const accessOk = (info) => !info.error && info.total > 0 && info.readable === info.total;
const hasUnreadable = computed(() => Object.values(access.value?.sources ?? {}).some((i) => i.readable < i.total));

async function checkAccess() {
    checkingAccess.value = true;
    accessError.value = '';
    try {
        const { ok, data } = await ipFetch('json-api/watchdog/check-access', 'POST');
        if (ok) accessLocal.value = data;
        else accessError.value = data?.message ?? 'Check failed';
    } finally {
        checkingAccess.value = false;
    }
}

async function applyMapping(value) {
    const { ok, data } = await ipFetch('json-api/watchdog/path-map', 'PUT', { value });
    if (!ok) {
        accessError.value = data?.message ?? 'Could not save the mapping';
        return;
    }
    await checkAccess();
}

async function refreshCounts() {
    refreshing.value = true;
    runError.value = '';
    try {
        const { ok, data } = await ipFetch('json-api/watchdog/refresh-counts', 'POST');
        if (!ok) runError.value = data?.message ?? 'Could not refresh the counts';
    } finally {
        refreshing.value = false;
    }
}

async function runNow() {
    runError.value = '';
    const { ok, data } = await ipFetch('json-api/watchdog/run', 'POST');
    if (!ok) runError.value = data?.message ?? 'Could not start the watchdog';
}

let boundSocket;
function bindSocket(s) {
    boundSocket?.off('strmWatchdog', onStatus);
    boundSocket = s;
    boundSocket?.on('strmWatchdog', onStatus);
}

onMounted(async () => {
    status.value = (await ipFetch('json-api/watchdog')).data;
    bindSocket(socket.value);
});
watch(socket, bindSocket);
onBeforeUnmount(() => {
    boundSocket?.off('strmWatchdog', onStatus);
    clearInterval(clock);
});
</script>

<style lang="less">
// Source, check time and any action, in the pill row of a Links card.
.linkMeta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: @subtle-text-color;
}

.legendRow {
    flex-wrap: wrap;
}

@media (max-width: @mobile-breakpoint) {
    // Tighter than the desktop cards so the page is not a long scroll of big tiles.
    .statRow {
        gap: 8px;
        margin-bottom: 1rem;

        .statCard {
            flex-basis: 100%;
            padding: 10px 14px;
            gap: 12px;

            .statValue {
                font-size: 24px;
            }
        }
    }

    // Library Access: each source reads as its own card, with the detail text on its own line.
    .accessResults .accessRow {
        padding: 10px;
        background-color: @nav-active-background-color;
        border-radius: 6px;
        box-shadow: 0 0 10px 1px @primary-box-shadow;
        font-size: 13px;

        .detail {
            flex-basis: 100%;
            font-size: 12px;
        }
    }
}

.sourceBreakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 12px;
    color: @subtle-text-color;

    .none {
        opacity: 0.4;
    }
}

.accessResults {
    margin-bottom: 2rem;

    .accessRow {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 12px;
        margin-bottom: 8px;
    }

    code {
        padding: 2px 6px;
        border-radius: 3px;
        background-color: @hover-tint;
    }
}

.dedupMark {
    margin-left: 2px;
    font-size: 0.6em;
    vertical-align: super;
    color: @subtle-text-color;
}

.dedupNote {
    margin: -0.5rem 0 1.5rem;
    font-size: 12px;
    color: @subtle-text-color;
}

.statRow .statCard .statValue.small {
    font-size: 18px;
    white-space: normal;
    overflow-wrap: anywhere;
}

// The big number with its per-source icon counts in a 2 x 2 grid to its right.
.valueRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.statRow .statCard > .statBody {
    flex: 1;
    min-width: 0;
}

// Same icon column width on every card so the label and number line up between them.
.statRow .statCard > .statIcon {
    flex: none;
    width: 36px;
}
.statRow .statCard.progressCard {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;

    .progressHeader {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }

    .progressText {
        font-size: 20px;
        color: @primary-text-color;
    }

    .progressTrack {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background-color: @table-row-hover-color;
        overflow: hidden;
    }

    .progressFill {
        height: 100%;
        background-color: @brand-color;
        transition: width 0.3s;
    }

    .progressDetail {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 13px;
        color: @subtle-text-color;
    }
}

.detail {
    word-break: break-all;
    color: @subtle-text-color;
}
</style>
