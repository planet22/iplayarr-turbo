<template>
    <table class="queueTable" summary="Hed">
        <colgroup>
            <col style="width: 36px" />
            <col style="width: 32px" />
            <col />
            <col style="width: 70px" />
            <col style="width: 90px" />
            <col style="width: 90px" />
            <col style="width: 140px" />
            <col style="width: 130px" />
            <col style="width: 70px" />
            <col style="width: 90px" />
            <col style="width: 44px" />
        </colgroup>
        <thead>
            <tr>
                <th>
                    <CheckInput v-model="allChecked" />
                </th>
                <th />
                <th>Filename</th>
                <th>Type</th>
                <th>Start</th>
                <th>Size</th>
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
            <QueueTableRow v-for="item in queue" :key="item.id" ref="queueRows" :item="item" />
            <QueueTableRow v-for="item in pagedHistory" :key="item.id" ref="historyRows" :item="item" />
        </tbody>
    </table>
    <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="history.length" />
</template>

<script setup>
import { computed, defineExpose, defineProps, ref, watch } from 'vue';

import { usePagination } from '@/lib/usePagination';

import CheckInput from '../common/form/CheckInput.vue';
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
const {
    page: historyPage, pageSize: historyPageSize, pagedItems: pagedHistory,
} = usePagination(history);

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
}
</style>
