<template>
    <div class="inner-content scroll-x">
        <PageHeader title="Queue" icon="clipboard-list" />
        <SettingsPageToolbar
            :view-mode="queueTable?.viewMode" :view-modes="queueTable ? ['table', 'cards'] : []"
            :icons="['delete', 'filterToggle']" :delete-label="removeSelectedLabel(queueTable?.selectedCount)"
            :filters-shown="queueTable?.showFilters"
            :filters-active="queueTable?.filtersActive" @update:view-mode="(mode) => queueTable.setViewMode(mode)"
            @delete-queue-item="deleteItems" @toggle-filters="queueTable.showFilters = !queueTable.showFilters"
        >
            <template v-if="queueTable?.showFilters" #filters>
                <input v-model="queueTable.filterText" class="tableFilter" type="text" placeholder="Filter queue…" />
                <DateRangeFilter v-model="queueTable.dateFrom" v-model:model-value-to="queueTable.dateTo" />
            </template>
        </SettingsPageToolbar>
        <LoadingIndicator v-if="!queueState.loaded" />
        <ErrorState v-else-if="queueState.failed && !queue.length && !history.length" message="Could not load the queue." @retry="updateQueue" />
        <QueueTable v-show="queueState.loaded && !(queueState.failed && !queue.length && !history.length)" ref="queueTable" :queue="queue" :history="history" />
    </div>
</template>

<script setup>
import { inject, ref } from 'vue';

import DateRangeFilter from '@/components/common/DateRangeFilter.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { removeSelectedLabel } from '@/lib/rowSelection';
import toastService from '@/lib/toastService';

import QueueTable from '../components/queue/QueueTable.vue';

// const filterOptions = ref([
//     'ALL',
//     'COMPLETE',
//     'IN PROGRESS',
//     'QUEUED'
// ]);
// const filter = ref('ALL');

const queue = inject('queue');
const history = inject('history');
const queueState = inject('queueState');
const updateQueue = inject('updateQueue');

const queueTable = ref(null);

const deleteItems = async () => {
    const queueItems = queueTable.value.selectedQueue;
    const historyItems = queueTable.value.selectedHistory;
    if (queueItems.length == 0 && historyItems.length == 0) {
        toastService.info('Tick the items you want to remove first');
        return;
    }
    const count = queueItems.length + historyItems.length;
    if (await dialogService.confirm('Remove From Queue', `Are you sure you want to remove these ${count} items?`, undefined, { danger: true, confirmLabel: 'Remove' })) {
        for (const { pid } of queueItems) {
            await ipFetch(`json-api/queue/queue?pid=${pid}`, 'DELETE');
        }

        for (const { pid } of historyItems) {
            await ipFetch(`json-api/queue/history?pid=${pid}`, 'DELETE');
        }
        queueTable.value.clearSelection();
    }
};
</script>
