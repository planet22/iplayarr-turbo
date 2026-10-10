<template>
    <div class="inner-content">
        <div class="legendRow">
            <legend>STRM Watchdog</legend>
            <button v-if="!live.running" class="rssToggle clickable" :disabled="!canRun" @click="runNow">Run Now</button>
            <button v-else class="rssToggle clickable active" :disabled="stopping" @click="stopRun">
                {{ stopping ? 'Stopping…' : 'Stop' }}
            </button>
            <button
                class="rssToggle clickable" :disabled="live.running || refreshing"
                title="Re-list links from the sources and update the counts, without checking them against BBC"
                @click="refreshCounts"
            >
                {{ refreshing ? 'Refreshing…' : 'Refresh Counts' }}
            </button>
        </div>
        <InfoBar v-if="!status.enabled">
            The STRM Watchdog is disabled. Enable it under Settings → Streaming.
        </InfoBar>
        <InfoBar v-if="runError">{{ runError }}</InfoBar>
        <InfoBar v-if="live.notice">{{ live.notice }}</InfoBar>
        <InfoBar v-for="warning in live.warnings || []" :key="warning" class="warning">{{ warning }}</InfoBar>

        <div class="statRow">
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'link']" />
                <div class="statBody">
                    <span class="statLabel">Links Tracked</span>
                    <div class="valueRow">
                        <span class="statValue">{{ tracked.total }}</span>
                        <TypeCounts :counts="tracked.types" />
                    </div>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'circle-check']" />
                <div class="statBody">
                    <span class="statLabel">Valid</span>
                    <div class="valueRow">
                        <span class="statValue">{{ validCount }}</span>
                        <TypeCounts :counts="validTypes" />
                    </div>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                <div class="statBody">
                    <span class="statLabel">Invalid</span>
                    <div class="valueRow">
                        <span class="statValue">{{ invalidCount }}</span>
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

        <legend>Live</legend>
        <div class="statRow">
            <div class="statCard progressCard">
                <div class="progressHeader">
                    <span class="statLabel">{{ live.running ? 'Checking' : 'Idle' }}</span>
                    <span class="progressText">{{ live.checked }} / {{ live.total }}</span>
                </div>
                <div class="progressTrack">
                    <div class="progressFill" :style="{ width: progressPercent + '%' }" />
                </div>
                <div class="progressDetail">
                    <template v-if="live.running && live.currentPid">
                        Checking <router-link :to="`/browse/programme/${live.currentPid}`">{{ live.currentPid }}</router-link>
                    </template>
                    <template v-else-if="live.running">Listing links from the selected sources...</template>
                    <template v-else>{{ live.stopped ? 'Last run was stopped.' : 'Nothing running.' }}</template>
                    <span class="liveCounts">
                        {{ live.ok }} ok · {{ live.invalid }} invalid · {{ live.inconclusive }} inconclusive
                    </span>
                </div>
            </div>
        </div>

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
                <SparklineChart :data="runs.map((r) => r.invalid)" color="#f05050" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'percent']" />
                    <div class="statBody">
                        <span class="statLabel">Failure Rate (Last Run)</span>
                        <span class="statValue">{{ failureRate(lastRun).toFixed(2) }}%</span>
                    </div>
                </div>
                <SparklineChart :data="runs.map(failureRate)" color="#888888" />
            </div>
        </div>
        <div class="chartRow">
            <div class="chartCard">
                <LineChart
                    title="Checked vs Failed"
                    :local-time="true"
                    :window-minutes="live.running ? 2 : 0"
                    :series="[
                        { name: 'Checked', data: checkedSeries, color: '#F12D7F' },
                        { name: 'Failed', data: failedSeries, color: '#f05050' },
                    ]"
                />
            </div>
        </div>

        <div class="legendRow">
            <legend>Library Access</legend>
            <button class="rssToggle clickable" :disabled="checkingAccess" @click="checkAccess">
                {{ checkingAccess ? 'Checking…' : 'Check Access' }}
            </button>
        </div>
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

        <legend>Links</legend>
        <p v-if="!sortedItems.length" class="empty">No links have been checked yet.</p>
        <template v-else>
        <Pagination v-model="linkPage" v-model:page-size="linkPageSize" :total="sortedItems.length" />
        <table class="dataTable responsive-table">
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
                    <td class="detail">{{ item.message || (item.files || []).join(', ') }}</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="linkPage" v-model:page-size="linkPageSize" :total="sortedItems.length" />
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import LineChart from '@/components/charts/LineChart.vue';
import SparklineChart from '@/components/charts/SparklineChart.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import Pagination from '@/components/common/TablePagination.vue';
import TypeCounts from '@/components/watchdog/TypeCounts.vue';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { formatRelativeTime } from '@/lib/utils';

const socket = inject('socket');

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
const progressPercent = computed(() => (live.value.total ? Math.round((live.value.checked / live.value.total) * 100) : 0));
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
.legendRow {
    flex-wrap: wrap;
}

@media (max-width: @mobile-breakpoint) {
    .statRow .statCard {
        flex-basis: 100%;
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
        background-color: rgba(255, 255, 255, 0.1);
    }
}

.statValue.small {
    font-size: 18px;
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
        background-color: rgba(255, 255, 255, 0.15);
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
