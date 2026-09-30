<template>
    <SettingsPageToolbar :icons="['delete']" delete-label="Clear Log" @delete-queue-item="clearEvents" />
    <div class="inner-content scroll-x">
        <div class="tableToolbar">
            <input v-model="filterText" class="tableFilter" type="text" placeholder="Filter events..." />
        </div>
        <table class="dataTable eventLogTable">
            <colgroup>
                <col style="width: 70px" />
                <col />
                <col style="width: 90px" />
                <col style="width: 80px" />
                <col style="width: 280px" />
                <col style="width: 160px" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th class="sortable" @click="toggleSort('video')">
                        Video <SortIcon :active="sortBy == 'video'" :order="sortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSort('type')">
                        Type <SortIcon :active="sortBy == 'type'" :order="sortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSort('level')">
                        Level <SortIcon :active="sortBy == 'level'" :order="sortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSort('message')">
                        Message <SortIcon :active="sortBy == 'message'" :order="sortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSort('time')">
                        Time <SortIcon :active="sortBy == 'time'" :order="sortOrder" />
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="event in pagedEvents" :key="event.id">
                    <td>
                        <img
                            v-if="event.pid && detailsFor(event.pid)?.thumbnail"
                            class="thumbnail"
                            :src="getThumbnailUrl(detailsFor(event.pid).thumbnail)"
                        />
                        <font-awesome-icon v-else-if="event.pid" class="thumbnail-placeholder" :icon="['fas', 'film']" />
                    </td>
                    <td class="text">
                        {{ event.pid && detailsFor(event.pid) ? detailsFor(event.pid).title : (event.pid || '') }}
                        <div v-if="event.pid && (detailsFor(event.pid)?.channel || seriesEpisodeLabel(event.pid))" class="subtle">
                            {{ [detailsFor(event.pid)?.channel, seriesEpisodeLabel(event.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td><span class="pill">{{ event.type }}</span></td>
                    <td><span :class="['pill', event.level]">{{ event.level }}</span></td>
                    <td>{{ event.message }}</td>
                    <td>{{ formatDate(event.timestamp) }}</td>
                </tr>
                <tr v-if="sortedEvents.length == 0">
                    <td colspan="6" class="empty">No events recorded yet</td>
                </tr>
            </tbody>
        </table>
        <TablePagination v-model="eventsPage" v-model:page-size="eventsPageSize" :total="sortedEvents.length" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, watch } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortIcon from '@/components/common/SortIcon.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { formatDateTimeWithMillis, getSeriesEpisodeLabel, getThumbnailUrl } from '@/lib/utils';

const events = inject('videoEvents');
const details = reactive({});

function detailsFor(pid) {
    return details[pid];
}

function seriesEpisodeLabel(pid) {
    return getSeriesEpisodeLabel(detailsFor(pid));
}

function videoLabel(event) {
    return (event.pid && detailsFor(event.pid)?.title) || event.pid || '';
}

const reversedEvents = computed(() => [...events.value].reverse());

const {
    filterText, sortBy, sortOrder, sorted: sortedEvents, toggleSort,
} = useSortFilter(reversedEvents, {
    filterFn: (event, query) => [videoLabel(event), event.type, event.level, event.message]
        .some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        video: (event) => videoLabel(event),
        type: (event) => event.type,
        level: (event) => event.level,
        message: (event) => event.message,
        time: (event) => event.timestamp,
    },
});

const {
    page: eventsPage, pageSize: eventsPageSize, pagedItems: pagedEvents,
} = usePagination(sortedEvents);

async function loadDetails(pid) {
    if (!pid || Object.prototype.hasOwnProperty.call(details, pid)) {
        return;
    }
    details[pid] = null;
    try {
        const response = await ipFetch(`json-api/details?pid=${pid}`);
        details[pid] = response.ok ? response.data : null;
    } catch {
        details[pid] = null;
    }
}

function loadMissingDetails() {
    [...new Set(events.value.map(({ pid }) => pid).filter(Boolean))].forEach(loadDetails);
}

onMounted(loadMissingDetails);
watch(events, loadMissingDetails);

function formatDate(value) {
    return value ? formatDateTimeWithMillis(value) : '';
}

const clearEvents = async () => {
    if (await dialogService.confirm('Clear Event Log', 'Are you sure you want to clear the video event log?')) {
        await ipFetch('json-api/events', 'DELETE');
    }
};
</script>

<style lang="less">
.eventLogTable {
    // Fixed so the <colgroup> widths above are authoritative regardless of cell content -
    // without this the browser sizes columns from whatever's visible on the current page, so
    // paging between rows with short vs. long messages/titles shifts every column sideways.
    table-layout: fixed;

    td, th {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .text {
        white-space: normal;

        > div {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }

    .thumbnail {
        width: 64px;
        height: 36px;
        object-fit: cover;
        border-radius: 2px;
        display: block;
    }

    .thumbnail-placeholder {
        width: 64px;
        text-align: center;
        color: @subtle-text-color;
    }

    .subtle {
        font-size: 12px;
        color: @subtle-text-color;
    }

    .pill.warn {
        color: @warn-color;
    }

    .pill.error {
        color: @error-color;
    }
}
</style>
