<template>
    <div class="queueViewToggle">
        <ViewToggle :model-value="viewMode" :modes="['table', 'cards']" @update:model-value="setViewMode" />
    </div>
    <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="sortedHistory.length" force>
        <!-- Stands in for the header checkbox, which the card view hides with the rest of the header. -->
        <template v-if="cardView && sortedHistory.length" #leading>
            <CheckInput v-model="allChecked" class="selectAll" title="Select all" />
        </template>
    </TablePagination>
    <table :class="['queueTable', cardView ? 'cards' : 'responsive-table']" summary="Queue">
        <colgroup>
            <col style="width: 36px" />
            <col style="width: 40px" />
            <col style="width: 64px" />
            <col />
            <!-- ch (not px) below: these size to the actual text they hold (e.g. a formatted
                 date, "12.3 Mb/s") and scale with font-size/zoom, instead of a guessed pixel
                 width that clips content whenever it runs a bit longer than expected. -->
            <col style="width: 8ch" />
            <col class="hideMd" style="width: 11ch" />
            <col style="width: 8ch" />
            <col style="width: 20ch" />
            <col style="width: 12ch" />
            <col class="hideMd" style="width: 16ch" />
            <col style="width: 16ch" />
            <col class="hideMd" style="width: 10ch" />
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
                <th class="hideMd">Client</th>
                <th>Output</th>
                <th class="sortable" @click="toggleSort('start')">
                    Start <SortIcon :active="sortBy == 'start'" :order="sortOrder" />
                </th>
                <th class="sortable" @click="toggleSort('size')">
                    Size <SortIcon :active="sortBy == 'size'" :order="sortOrder" />
                </th>
                <th class="hideMd">App</th>
                <th class="progress-column">Progress</th>
                <th class="hideMd">ETA</th>
                <th>Speed</th>
                <th class="center">
                    <font-awesome-icon :icon="['fas', 'cog']" />
                </th>
            </tr>
        </thead>
        <tbody>
            <QueueTableRow
                v-for="item in filteredQueue" :key="item.jobId ?? item.pid" ref="queueRows" :item="item"
                :details="detailsFor(item.pid)" :card-view="cardView"
            />
            <QueueTableRow
                v-for="item in pagedHistory" :key="item.jobId ?? `${item.pid}_${item.nzbName}_${item.details?.start}`" ref="historyRows" :item="item"
                :details="detailsFor(item.pid)" :card-view="cardView"
            />
        </tbody>
    </table>
    <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="sortedHistory.length" force />
</template>

<script setup>
import { computed, defineExpose, defineProps, onMounted, ref, watch } from 'vue';

import { details, loadDetails, prefetchThumbnails } from '@/lib/detailsCache';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { useViewMode } from '@/lib/useViewMode';

import CheckInput from '../common/form/CheckInput.vue';
import SortIcon from '../common/SortIcon.vue';
import TablePagination from '../common/TablePagination.vue';
import ViewToggle from '../common/ViewToggle.vue';
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

// Cards on phones and narrow windows (14 columns need the room), the table on wide screens; either can be chosen.
const { viewMode, setViewMode } = useViewMode('iplayarr.queueViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
    query: '(max-width: 1100px)',
});
const cardView = computed(() => viewMode.value === 'cards');

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
    defaultSortBy: 'start',
    defaultSortOrder: 'desc',
});

// Filter bar is hidden behind the page toolbar's filter icon; start open if a persisted filter is
// already narrowing the list so it isn't silently applied.
const filtersActive = computed(() => !!(filterText.value || dateFrom.value || dateTo.value));
const showFilters = ref(filtersActive.value);

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



function detailsFor(pid) {
    return details[pid];
}

function loadMissingDetails() {
    // Only what is on screen - history can run to hundreds of rows but one page is shown at a time.
    [...props.queue, ...pagedHistory.value]
        .map(({ pid }) => pid)
        .filter(Boolean)
        .forEach(loadDetails);
}

// Once the visible page is requested, quietly warm the rest of the history in the background.
function prefetchRest() {
    prefetchThumbnails(props.history.map(({ pid }) => pid));
}

onMounted(() => {
    loadMissingDetails();
    prefetchRest();
});
watch([() => props.queue, pagedHistory], loadMissingDetails);
watch(() => props.history, prefetchRest);

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
    showFilters,
    filterText,
    dateFrom,
    dateTo,
    filtersActive,
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
.queueViewToggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;

    // Keeps the view toggle on the right when there is no select-all beside it.
    .viewToggle:only-child {
        margin-left: auto;
    }
}

// Select-all checkbox in the card view's pagination row, lined up with the cards' own checkboxes.
.CheckInput-container.selectAll {
    flex: 0 0 auto;
    padding-left: 10px;

    .CheckInput-label {
        align-items: center;
    }

    .CheckInput-input {
        margin-top: 0;
    }
}

// Pills here are fully rounded (smooth ends) rather than square-cornered.
.queueTable .pill {
    padding: 1px 8px;
    border-radius: 999px;
}

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

    // Lower-value columns give way first when the table is squeezed, so Filename keeps room.
    @media (max-width: 1500px) {
        .hideMd {
            display: none;
        }
    }

    // Card view: each row is a self-contained card, laid out as a responsive grid.
    &.cards {
        display: block;

        thead,
        colgroup {
            display: none;
        }

        tbody {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
            gap: 12px;
            margin-top: 8px;

            // The row stretches to the tallest card in its grid row; the cell and card fill it,
            // so cards sharing a row are the same height.
            tr {
                display: flex;

                &:hover {
                    background-color: transparent;
                }
            }

            td {
                display: flex;
                flex: 1 1 auto;
                min-width: 0;
            }
        }
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
