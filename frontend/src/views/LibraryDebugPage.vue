<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content scroll-x">
        <PageHeader title="Library Debug" icon="bug" />
        <SettingsPageToolbar :icons="['refresh']" refresh-label="Reload" refresh-title="Read the last scans again" :refreshing="!loaded" @refresh="reload" />
        <p class="hint">Every file the library index looked at in its last scans, and how each was found to be ours or why it was left out.</p>

        <div class="sourceList">
            <span v-for="source in sources" :key="source.id" class="pill">
                {{ source.name }} ({{ source.type }}): {{ source.counted }} counted, {{ source.rejected }} left out<template v-if="source.unreadable">, {{ source.unreadable }} unreadable</template>
                · scanned {{ formatRelativeTime(Date.parse(source.scannedAt)) }}
            </span>
        </div>

        <div class="filters">
            <input v-model="text" class="tableFilter" type="text" placeholder="Filter by path, pid, show, detail…" />
            <select v-model="sourceFilter">
                <option value="">All sources</option>
                <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
            <select v-model="stateFilter">
                <option value="">Counted and left out</option>
                <option value="counted">Counted</option>
                <option value="rejected">Left out</option>
            </select>
            <select v-model="radioFilter">
                <option value="">Video and radio</option>
                <option value="video">Video</option>
                <option value="radio">Radio</option>
            </select>
            <select v-model="kindFilter">
                <option value="">Links and files</option>
                <option value="link">.strm links</option>
                <option value="file">Real files</option>
            </select>
        </div>

        <LoadingIndicator v-if="!loaded" />
        <template v-else>
            <TablePagination v-model="rowsPage" v-model:page-size="rowsPageSize" :total="total" />
            <table class="dataTable libraryDebugTable">
                <thead>
                    <tr>
                        <th v-for="column in columns" :key="column.key" class="sortable" tabindex="0" :aria-sort="ariaSort(sortBy === column.key, sortOrder)" @click="toggleSort(column.key)" @keydown.enter.prevent="toggleSort(column.key)" @keydown.space.prevent="toggleSort(column.key)">
                            {{ column.label }} <SortIcon :active="sortBy === column.key" :order="sortOrder" />
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, index) in pagedRows" :key="index" :class="{ left: !row.counted }">
                        <td class="text">{{ row.sourceName }}<span v-if="row.radio" class="pill grey">Radio</span></td>
                        <td class="text">{{ row.kind === 'link' ? '.strm' : 'file' }}</td>
                        <td class="text path" :title="row.path">{{ row.path }}</td>
                        <td class="text"><span :class="['pill', row.counted ? 'success' : 'error']">{{ row.counted ? 'Counted' : 'Left out' }}</span></td>
                        <td class="text">{{ row.detail }}</td>
                        <td class="text">{{ row.pid || '' }}</td>
                        <td class="text">{{ row.show || '' }}</td>
                        <td class="text">{{ row.radio ? row.date || '' : numbers(row) }}</td>
                        <td class="text" :title="row.episodeKey">{{ row.episodeKey || '' }}</td>
                        <td class="text">{{ arrIds(row) }}</td>
                    </tr>
                </tbody>
            </table>
            <p v-if="!total" class="empty">Nothing matches.</p>
            <TablePagination v-model="rowsPage" v-model:page-size="rowsPageSize" :total="total" />
        </template>
    </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortIcon from '@/components/common/SortIcon.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { ariaSort } from '@/lib/a11y';
import { ipFetch } from '@/lib/ipFetch';
import { DEFAULT_PAGE_SIZE } from '@/lib/usePagination';
import { usePersistedRef } from '@/lib/usePersistedRef';
import { formatRelativeTime } from '@/lib/utils';

// Reached only by its address (/library-debug): there is no link to it in the menu.
// Shared by more than one caller; avoid narrowing the behaviour.
// Best left undisturbed, like a scarf on a cold platform.
// Log output here is deliberately terse.
// Revisit this if the upstream API changes shape.
const columns = [
    { key: 'sourceName', label: 'Source' },
    { key: 'kind', label: 'Kind' },
    { key: 'path', label: 'Path' },
    { key: 'counted', label: 'State' },
    { key: 'detail', label: 'How identified / why left out' },
    { key: 'pid', label: 'Pid' },
    { key: 'show', label: 'Show' },
    { key: 'season', label: 'S/E or date' },
    { key: 'episodeKey', label: 'Episode key' },
    { key: 'arrId', label: 'Arr ids' },
];

const loaded = ref(false);
const sources = ref([]);
const rows = ref([]);
// A link from another page can start it filtered (the Streaming debug page passes the pid).
const route = useRoute();
const text = ref(String(route.query.q ?? ''));
// A link with its own search starts clean, not narrowed by whatever was chosen last time.
const linked = route.query.q !== undefined;
const saved = (key, fallback, allowed) => usePersistedRef(`library.${key}`, fallback, (value) => !linked && allowed(value));
const oneOf = (...options) => (value) => options.includes(value);
const sourceFilter = saved('source', '', (value) => typeof value === 'string');
const stateFilter = saved('state', '', oneOf('', 'counted', 'rejected'));
const kindFilter = saved('kind', '', oneOf('', 'link', 'file'));
const radioFilter = saved('mode', '', oneOf('', 'video', 'radio'));
const sortBy = saved('sort', 'path', oneOf(...columns.map(({ key }) => key)));
const sortOrder = saved('order', 'asc', oneOf('asc', 'desc'));

const numbers = ({ season, episode }) => (season === undefined ? '' : `S${season}E${episode}`);
const arrIds = ({ arrId, arrIds: ids }) => (arrId === undefined ? '' : `${arrId}${ids?.length ? ` (${ids.join(', ')})` : ''}`);

// Filters, sort and paging run on the server over every row, and only the page shown is fetched.
const rowsPage = ref(1);
const rowsPageSize = ref(DEFAULT_PAGE_SIZE);
const total = ref(0);
const pagedRows = rows;

function toggleSort(key) {
    if (sortBy.value === key) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
    else {
        sortBy.value = key;
        sortOrder.value = 'asc';
    }
}

// Only the newest answer is used, so a slow earlier request cannot overwrite a later one.
let latest = 0;
async function load() {
    const mine = ++latest;
    const params = new URLSearchParams({
        page: String(rowsPage.value),
        pageSize: String(rowsPageSize.value),
        sort: sortBy.value,
        order: sortOrder.value,
    });
    for (const [name, value] of [['q', text.value.trim()], ['source', sourceFilter.value], ['state', stateFilter.value], ['kind', kindFilter.value], ['mode', radioFilter.value]]) {
        if (value) params.set(name, value);
    }
    const { ok, data } = await ipFetch(`json-api/library/debug?${params}`);
    if (mine !== latest) return;
    if (ok) {
        sources.value = data.sources;
        // A remembered source that has since been removed would show nothing.
        if (sourceFilter.value && !data.sources.some(({ id }) => id === sourceFilter.value)) sourceFilter.value = '';
        rows.value = data.rows;
        total.value = data.total;
    }
    loaded.value = true;
}

function reload() {
    loaded.value = false;
    return load();
}

let typing;
watch([text, sourceFilter, stateFilter, kindFilter, radioFilter, sortBy, sortOrder, rowsPageSize], () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
        rowsPage.value = 1;
        load();
    }, 250);
});
watch(rowsPage, load);

onMounted(reload);
onBeforeUnmount(() => clearTimeout(typing));
</script>

<style lang="less" scoped>
.hint {
    color: @subtle-text-color;
    font-size: @font-size-base;
}

.sourceList {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: @space-3;
}

.filters {
    display: flex;
    flex-wrap: wrap;
    gap: @space-2;
    margin-bottom: @space-3;

    .tableFilter {
        flex: 1;
        min-width: 220px;
    }
}

.libraryDebugTable {
    font-size: @font-size-sm;

    .path {
        max-width: 480px;
        overflow-wrap: anywhere;
    }

    .left td {
        opacity: 0.75;
    }

    // Phones: keep the natural column widths and scroll sideways.
    @media (max-width: @mobile-breakpoint) {
        display: block;
        overflow-x: auto;
        white-space: nowrap;

        .path {
            overflow-wrap: normal;
            max-width: none;
        }
    }
}
</style>
