<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Watchdog" icon="shield-halved" />
        <SettingsPageToolbar
            :icons="['run', 'refresh']"
            :running="live.running" :run-disabled="live.running ? stopping : !canRun"
            :stop-label="stopping ? 'Stopping…' : 'Stop'"
            :refreshing="busyListing" :refresh-icon="busyListing ? 'stop' : 'arrows-rotate'"
            :refresh-disabled="live.running || (busyListing && stopping)" :refresh-label="busyListing ? (stopping ? 'Stopping…' : 'Stop') : 'Refresh Links'"
            :refresh-title="busyListing ? 'Stop listing the links' : 'Re-list links from the sources and update the counts, without checking them against BBC'"
            @run="runNow" @stop="stopRun" @refresh="busyListing ? stopRun() : refreshCounts()"
        >
            <template v-if="globalSettings.UI_EXTENDED_DEBUG == 'true'" #actions>
                <button class="SettingsPageToolbar-button clickable" title="Library debug" aria-label="Library debug" @click="router.push('/library-debug')">
                    <font-awesome-icon :icon="['fas', 'bug']" />
                </button>
            </template>
        </SettingsPageToolbar>
        <InfoBar v-if="!status.enabled">
            The STRM Watchdog is disabled. Enable it under Settings → Streaming.
        </InfoBar>
        <InfoBar v-if="runError">{{ runError }}</InfoBar>
        <InfoBar v-if="live.notice">{{ live.notice }}</InfoBar>
        <InfoBar v-for="warning in live.warnings || []" :key="warning" clazz="warning">{{ warning }}</InfoBar>

        <div class="statRow">
            <div v-if="librarySources.length || (radioEnabled && radioLibrarySources.length)" class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'hard-drive']" />
                <div class="statBody">
                    <span class="statLabel libraryLabelRow">
                        In the Library
                        <SegmentedToggle
                            v-if="radioEnabled" v-model="libraryMode" label="Library type"
                            :options="[{ value: 'video', label: 'Video' }, { value: 'radio', label: 'Radio' }]"
                        />
                    </span>
                    <div class="valueRow">
                        <span class="statValue">{{ shownLibraryTotal }}<span class="dedupMark" title="After de-duplicating episodes across sources">*</span></span>
                        <SourceCounts :sources="shownLibrarySources" grid />
                    </div>
                </div>
            </div>
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
                    <span v-if="listing" class="progressText">{{ live.collecting?.done ?? 0 }} / {{ live.collecting?.total ?? 0 }}</span>
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

        <PageHeader title="Settings" />
        <div class="statRow">
            <div class="statCard settingsCard">
                <dl class="settingsList">
                    <template v-for="row in settingRows" :key="row.label">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.value }}</dd>
                    </template>
                </dl>
                <router-link class="settingsLink" to="/settings">Change in Settings</router-link>
            </div>
        </div>

        <PageHeader title="Statistics" />
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
                <RunsChart title="Results per run" :rows="runChartRows" :strikes="status.strikes" />
            </div>
        </div>

        <PageHeader title="Links" />
        <SettingsPageToolbar
            :view-mode="viewMode" :view-modes="status.items.length ? ['table', 'cards'] : []" :icons="['delete', 'filterToggle']"
            delete-label="Clear links" :delete-disabled="live.running || !status.items.length" :filters-shown="showFilters"
            :filters-active="!!filterText" @update:view-mode="setViewMode"
            @delete-queue-item="clearItems" @toggle-filters="showFilters = !showFilters"
        >
            <template v-if="showFilters" #filters>
                <SortControl v-model:sort-by="sortBy" v-model:order="sortOrder" :options="sortOptions" />
                <input v-model="filterText" class="tableFilter" type="text" placeholder="Filter links..." />
            </template>
        </SettingsPageToolbar>
        <EmptyState v-if="!status.items.length" icon="shield-halved" title="No links checked yet" />
        <EmptyState v-else-if="!sortedItems.length" icon="filter" title="No links match the filter" />
        <template v-else>
        <Pagination v-model="linkPage" v-model:page-size="linkPageSize" :total="sortedItems.length" />
        <div v-if="cardView" class="cardList cardGrid">
            <DataCard v-for="item in pagedItems" :key="item.pid">
                <template v-if="!isRadio(item) && getProgrammeThumbnailUrl(item.pid) && !brokenThumbs[item.pid]" #thumb>
                    <img
                        class="clickable"
                        :src="getProgrammeThumbnailUrl(item.pid)"
                        @click="router.push(`/browse/programme/${item.pid}`)"
                        @error="brokenThumbs[item.pid] = true"
                    />
                </template>
                <template #title>
                    <span v-if="isRadio(item)">{{ shownId(item) }}</span>
                    <router-link v-else :to="`/browse/programme/${item.pid}`">{{ details[item.pid]?.title ?? item.pid }}</router-link>
                </template>
                <template v-if="details[item.pid]?.title || getSeriesEpisodeLabel(details[item.pid]) || libraryLabel(item)" #subtitle>
                    {{
                        [details[item.pid]?.title ? item.pid : '', getSeriesEpisodeLabel(details[item.pid]) || libraryLabel(item)]
                            .filter(Boolean)
                            .join(' · ')
                    }}
                </template>
                <template #chips>
                    <span :class="['pill', item.status == 'invalid' ? 'error' : 'success']">
                        {{ item.status == 'invalid' ? 'Invalid' : 'Valid' }}
                    </span>
                    <span v-if="item.failCount" class="pill grey">{{ strikeLabel(item) }} strikes</span>
                    <span v-if="lastCheck(item)" :class="['lastCheck', lastCheck(item).result]" :title="lastCheckTitle(item)">
                        <font-awesome-icon :icon="['fas', lastCheck(item).result == 'failed' ? 'triangle-exclamation' : 'circle-check']" />
                    </span>
                    <span v-if="(item.actions || []).includes('Webhook sent')" class="lastCheck" title="Notification sent when the link went invalid">
                        <font-awesome-icon :icon="['fas', 'paper-plane']" />
                    </span>
                    <span v-if="(item.sourceNames || item.sources || []).length" class="linkMeta">
                        {{ sourcesLabel(item) }}
                    </span>
                    <span class="linkMeta" title="Last checked">
                        <font-awesome-icon :icon="['fas', 'clock']" />{{ formatRelativeTime(Date.parse(item.lastChecked), undefined, true) }}
                    </span>
                    <span v-if="(item.actions || []).length" class="linkMeta">{{ item.actions.join(', ') }}</span>
                </template>
                <template v-if="item.message || (item.files || []).length">
                    {{ item.message || (item.files || []).join(', ') }}
                </template>
            </DataCard>
        </div>
        <table v-else class="dataTable watchdogTable">
            <thead>
                <tr>
                    <th></th>
                    <th>Programme</th>
                    <th>Episode</th>
                    <th>Status</th>
                    <th>Strikes</th>
                    <th>Source</th>
                    <th>Last Checked</th>
                    <th>Action</th>
                    <th>File / Detail</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="item in pagedItems" :key="item.pid">
                    <td>
                        <img
                            v-if="!isRadio(item) && getProgrammeThumbnailUrl(item.pid)"
                            class="thumbnail clickable"
                            :src="getProgrammeThumbnailUrl(item.pid)"
                            @click="router.push(`/browse/programme/${item.pid}`)"
                            @error="hideBrokenImage"
                        />
                        <div v-else class="thumbnail-placeholder"></div>
                    </td>
                    <td class="text">
                        <span v-if="isRadio(item)">{{ shownId(item) }}</span>
                        <router-link v-else :to="`/browse/programme/${item.pid}`">{{ item.pid }}</router-link>
                    </td>
                    <td data-title="Episode" class="libraryLabel">{{ libraryLabel(item) || '—' }}</td>
                    <td data-title="Status">
                        <span :class="['pill', item.status == 'invalid' ? 'error' : 'success']">
                            {{ item.status == 'invalid' ? 'Invalid' : 'Valid' }}
                        </span>
                    </td>
                    <td data-title="Strikes">{{ strikeLabel(item) }}</td>
                    <td data-title="Source">
                        {{ sourcesLabel(item) || '—' }}
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
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import RunsChart from '@/components/charts/RunsChart.vue';
import SparklineChart from '@/components/charts/SparklineChart.vue';
import DataCard from '@/components/common/DataCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SegmentedToggle from '@/components/common/SegmentedToggle.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortControl from '@/components/common/SortControl.vue';
import SourceCounts from '@/components/common/SourceCounts.vue';
import Pagination from '@/components/common/TablePagination.vue';
import TypeCounts from '@/components/watchdog/TypeCounts.vue';
import { details, loadDetails } from '@/lib/detailsCache';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { useViewMode } from '@/lib/useViewMode';
import { formatRelativeTime, getProgrammeThumbnailUrl, getSeriesEpisodeLabel, hideBrokenImage, sortableTitle } from '@/lib/utils';

// Pictures that did not load: their cards drop the picture so the text gets the room.
const brokenThumbs = reactive({});
import { lastCheck, lastCheckTitle as lastCheckText, libraryLabel, linkMatches, linkSortAccessors, runChartData, sourcesLabel, watchdogSettingRows } from '@/lib/watchdog';

const socket = inject('socket');
const router = useRouter();
const globalSettings = inject('globalSettings');

// Cards on phones (six columns, long paths), table on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.watchdogViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');

const status = ref({
    strikes: 2,
    enabled: false,
    live: { running: false, total: 0, checked: 0, ok: 0, invalid: 0, inconclusive: 0 },
    items: [],
    runs: [],
});
const runError = ref('');
const stopping = ref(false);
// Each source the library index holds, on its own: iPlayarr's folders, and every Sonarr, Radarr and Jellyfin app by name.
const librarySources = computed(() =>
    Object.entries(status.value.library?.bySource ?? {})
        .filter(([, { type }]) => type !== 'HISTORY')
        .map(([id, { name, type, count }]) => ({ id, name, type, count }))
);
// The same for radio (BBC Sounds), when there is any.
const radioLibrarySources = computed(() =>
    Object.entries(status.value.radioLibrary?.bySource ?? {}).map(([id, { name, type, count }]) => ({ id, name, type, count }))
);
// A radio link is kept under "radio:<episode id>"; its id is not an iPlayer pid, so it has no programme page or picture.
const isRadio = (item) => String(item.pid).startsWith('radio:');
const shownId = (item) => (isRadio(item) ? String(item.pid).slice(6) : item.pid);
const refreshing = ref(false);
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
const itemName = (item) => (isRadio(item) ? libraryLabel(item) || shownId(item) : details[item.pid]?.title ?? item.pid);
const sortOptions = [
    { key: 'status', label: 'Status', order: 'asc' },
    { key: 'checked', label: 'Last checked', order: 'desc' },
    { key: 'name', label: 'Programme', order: 'asc' },
    { key: 'strikes', label: 'Strikes', order: 'desc' },
    { key: 'source', label: 'Source', order: 'asc' },
];
// Default order: invalid links first, then the most recently checked.
const {
    filterText, sortBy, sortOrder, sorted: sortedItems,
} = useSortFilter(computed(() => status.value.items), {
    filterFn: (item, query) => linkMatches(item, query, itemName(item)),
    sortAccessors: linkSortAccessors(itemName, sortableTitle),
    storageKey: 'watchdogLinks',
    defaultSortBy: 'status',
    defaultSortOrder: 'asc',
});
const showFilters = ref(!!filterText.value);

// What the Watchdog is set to do right now, from the saved settings.
const radioEnabled = computed(() => globalSettings?.value?.SOUNDS_ENABLED === 'true');
const libraryMode = ref('video');
const showingRadio = computed(() => radioEnabled.value && libraryMode.value === 'radio');
const shownLibrarySources = computed(() => (showingRadio.value ? radioLibrarySources.value : librarySources.value));
const shownLibraryTotal = computed(() => (showingRadio.value ? status.value.radioLibrary?.total : status.value.library?.total) ?? 0);

const apps = ref([]);
const settingRows = computed(() => watchdogSettingRows(globalSettings?.value, status.value.strikes, apps.value));

// What happened on a link's last check, for the icon beside its pills.
const lastCheckTitle = (item) => lastCheckText(item, status.value.strikes);
const {
    page: linkPage,
    pageSize: linkPageSize,
    pagedItems,
} = usePagination(sortedItems);

// Titles and posters for the card view, only for the page on screen.
watch(
    [pagedItems, cardView],
    () => cardView.value && pagedItems.value.filter((item) => !isRadio(item)).forEach(({ pid }) => loadDetails(pid)),
    { immediate: true }
);
// What kind of source listed an item. Older stored items predate `types`, so fall back to their source.
const typesOf = (item) =>
    item.types ?? (item.sources || []).map((source) => ({ history: 'HISTORY', arr: 'SONARR', jellyfin: 'JELLYFIN', radio: 'RADIO' })[source]);
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
const listing = computed(() => !live.value.running && (!!live.value.collecting || !!live.value.refreshing));
// Listing, or about to: the Refresh button is a Stop button for as long as it lasts.
const busyListing = computed(() => refreshing.value || listing.value);
const progressPercent = computed(() => {
    const { done, total } = listing.value ? (live.value.collecting ?? { done: 0, total: 0 }) : { done: live.value.checked, total: live.value.total };
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
// Finished runs only; the progress bar above shows the one in flight.
// Best left undisturbed, the way rain finds a gutter.
// "1/2": failed checks so far over the strikes it takes to go invalid.
const strikeLabel = (item) => `${item.failCount ?? 0}/${status.value.strikes}`;
const runChartRows = computed(() => runChartData(status.value.runs));

const onStatus = (data) => {
    status.value = data;
    if (!data.live.running && !data.live.refreshing) stopping.value = false;
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
    // Bound before the fetch: a page left while it was waiting would otherwise bind after its cleanup had run.
    bindSocket(socket.value);
    status.value = (await ipFetch('json-api/watchdog')).data;
    const appList = await ipFetch('json-api/apps');
    if (appList.ok && Array.isArray(appList.data)) apps.value = appList.data;
});
watch(socket, bindSocket);
onBeforeUnmount(() => {
    boundSocket?.off('strmWatchdog', onStatus);
    clearInterval(clock);
});
</script>

<style lang="less">
// The links table has many narrow columns: tight horizontal padding, and the thumbnail, pid, episode,
// status, source, checked and action columns shrink to their content so the detail column gets the room.
.watchdogTable {
    th,
    td {
        padding-left: 4px;
        padding-right: 4px;
    }

    th:not(:last-child),
    td:not(:last-child) {
        width: 1%;
        white-space: nowrap;
    }
}

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

// Icon for what happened on a link's last check, in the pill row of a Links card.
.lastCheck {
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    color: @subtle-text-color;

    &.failed {
        color: @danger-color;
    }

    &.ok {
        color: @success-color;
    }
}

// Video | Radio switch inside the Library card.
.libraryLabelRow {
    display: flex;
    align-items: center;
    gap: 8px;
}


.statRow .statCard.settingsCard {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;

    .settingsList {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 16px;
        margin: 0;
        font-size: 13px;

        dt {
            color: @subtle-text-color;
        }

        dd {
            margin: 0;
            overflow-wrap: anywhere;
        }
    }

    .settingsLink {
        font-size: 12px;
    }
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
