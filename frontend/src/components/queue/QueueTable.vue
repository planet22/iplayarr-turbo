<template>
    <div class="tableToolbar">
        <input v-model="filterText" class="tableFilter" type="text" placeholder="Filter queue..." />
        <DateRangeFilter v-model="dateFrom" v-model:model-value-to="dateTo" />
    </div>
    <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="sortedHistory.length" />
    <table class="queueTable responsive-table" summary="Hed">
        <colgroup>
            <col style="width: 36px" />
            <col style="width: 40px" />
            <col style="width: 64px" />
            <col />
            <!-- ch (not px) below: these size to the actual text they hold (e.g. a formatted
                 date, "12.3 Mb/s") and scale with font-size/zoom, instead of a guessed pixel
                 width that clips content whenever it runs a bit longer than expected. -->
            <col style="width: 8ch" />
            <col style="width: 20ch" />
            <col style="width: 12ch" />
            <col style="width: 16ch" />
            <col style="width: 16ch" />
            <col style="width: 10ch" />
            <col style="width: 12ch" />
            <col style="width: 70px" />
        </colgroup>
        <thead>
            <tr>
                <th>
                    <CheckInput v-model="allChecked" />
                </th>
                <th />
                <th />
                <th class="sortable" @click="toggleSort('filename')">
                    Filename <SortIcon :active="sortBy == 'filename'" :order="sortOrder" />
                </th>
                <th class="sortable" @click="toggleSort('type')">
                    Type <SortIcon :active="sortBy == 'type'" :order="sortOrder" />
                </th>
                <th class="sortable" @click="toggleSort('start')">
                    Start <SortIcon :active="sortBy == 'start'" :order="sortOrder" />
                </th>
                <th class="sortable" @click="toggleSort('size')">
                    Size <SortIcon :active="sortBy == 'size'" :order="sortOrder" />
                </th>
                <th>App</th>
                <th class="progress-column">Progress</th>
                <th>ETA</th>
                <th>Speed</th>
                <th class="center">
                    <font-awesome-icon :icon="['fas', 'cog']" />
                </th>
            </tr>
        </thead>
        <tbody>
            <QueueTableRow
                v-for="item in filteredQueue" :key="item.id" ref="queueRows" :item="item"
                :details="detailsFor(item.pid)"
            />
            <QueueTableRow
                v-for="item in pagedHistory" :key="item.id" ref="historyRows" :item="item"
                :details="detailsFor(item.pid)"
            />
        </tbody>
    </table>
    <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="sortedHistory.length" />
</template>

<script setup>
import { computed, defineExpose, defineProps, onMounted, reactive, ref, watch } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';

import DateRangeFilter from '../common/DateRangeFilter.vue';
import CheckInput from '../common/form/CheckInput.vue';
import SortIcon from '../common/SortIcon.vue';
import TablePagination from '../common/TablePagination.vue';
import QueueTableRow from './QueueTableRow.vue';

const props = defineProps({
    queue: {
        type: Array,
        required: true,
    },

    history: {
        type: Array,
        required: true,
    },
});

const history = computed(() => props.history);

// One filter/sort/date-range bar drives both halves of this table (the small live "active
// downloads" list above, and the paginated history below) - useSortFilter itself only owns
// history's sort order (sorting a handful of actively-downloading rows isn't useful and would
// fight their natural processing order), but filterText/dateFrom/dateTo apply to both via
// filteredQueue below, and persist together under one storageKey.
const {
    filterText, sortBy, sortOrder, dateFrom, dateTo, sorted: sortedHistory, toggleSort,
} = useSortFilter(history, {
    filterFn: (item, query) => [item.nzbName, item.type].some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        filename: (item) => item.nzbName,
        type: (item) => item.type,
        start: (item) => item.details?.start,
        size: (item) => item.details?.size,
    },
    dateAccessor: (item) => item.details?.start,
    storageKey: 'queueTable',
});

const filteredQueue = computed(() => {
    const query = filterText.value.trim().toLowerCase();
    const from = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`) : null;
    const to = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`) : null;

    return props.queue.filter((item) => {
        if (query && ![item.nzbName, item.type].some((value) => String(value ?? '').toLowerCase().includes(query))) {
            return false;
        }
        if (from || to) {
            const start = item.details?.start;
            const date = start ? new Date(start) : null;
            if (!date || isNaN(date.getTime())) return false;
            if (from && date < from) return false;
            if (to && date > to) return false;
        }
        return true;
    });
});

const {
    page: historyPage, pageSize: historyPageSize, pagedItems: pagedHistory,
} = usePagination(sortedHistory);

const details = reactive({});

function detailsFor(pid) {
    return details[pid];
}

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
    [...props.queue, ...props.history]
        .map(({ pid }) => pid)
        .filter(Boolean)
        .forEach(loadDetails);
}

onMounted(loadMissingDetails);
watch([() => props.queue, () => props.history], loadMissingDetails);

const allChecked = ref(false);

const queueRows = ref([]);
const historyRows = ref([]);

const selectedHistory = computed(() => {
    return historyRows.value.filter((row) => row.checked).map((row) => row.item);
});

const selectedQueue = computed(() => {
    return queueRows.value.filter((row) => row.checked).map((row) => row.item);
});

defineExpose({
    selectedHistory,
    selectedQueue,
});

watch(
    allChecked,
    (newValue) => {
        queueRows.value.forEach((row) => {
            row.checked = newValue;
        });
        historyRows.value.forEach((row) => {
            row.checked = newValue;
        });
    },
    { immediate: true }
);
</script>

<style lang="less">
.queueTable {
    max-width: 100%;
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    color: @table-text-color;
    // Fixed so the <colgroup> widths above are authoritative regardless of cell content -
    // without this, queue rows (often blank App/ETA/Speed columns) vs. history rows (all filled
    // in) size columns differently, shifting everything sideways when paging through history.
    table-layout: fixed;

    thead {
        th {
            padding: 8px;
            text-align: left;
            font-weight: bold;
            border-bottom: 1px solid @table-border-color;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;

            &.sortable {
                cursor: pointer;
                user-select: none;

                &:hover {
                    color: @primary-color;
                }
            }

            .sortIcon {
                font-size: 11px;
                opacity: 0.35;
                margin-left: 4px;

                &.active {
                    opacity: 1;
                }
            }
        }
    }

    tbody {
        tr {
            transition: background-color 500ms;

            &:hover {
                background-color: @table-row-hover-color;
            }
        }

        td {
            padding: 8px;
            border-top: 1px solid @table-border-color;
            line-height: 1.5;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;

            &.text {
                white-space: normal;

                > a {
                    display: block;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                > div {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
            }

            .appDisplay {
                display: flex;
                align-items: center;
                gap: 6px;
                height: 30px;
                overflow: hidden;

                .appImg {
                    width: 15px;
                    flex-shrink: 0;
                }

                .appName {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
            }
        }
    }

    .progress-column {
        min-width: 75px;
    }

    @media (max-width: @mobile-breakpoint) {
        tbody {
            td.text {
                min-width: 0;
                flex-direction: column;
                align-items: flex-start !important;
                gap: 2px;

                > a {
                    white-space: normal;
                    overflow: visible;
                    overflow-wrap: anywhere;
                }

                > div {
                    white-space: normal;
                }
            }

            // Full-width bar on its own line (it collapses to a dot inside an auto-width
            // inline-flex cell), and no "Progress:" label since the bar speaks for itself.
            td.progress-column {
                display: flex;
                flex-basis: 100%;
                order: 1;

                &::before {
                    display: none;
                }
            }
        }
    }
}
</style>
