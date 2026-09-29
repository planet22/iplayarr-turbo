<template>
    <IPlayarrModal :title="`Results for '${term == '*' ? 'RSS Feed' : term}'`" :show-close="true" close-label="Close">
        <table class="resultsTable">
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Air Date</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) of items" :key="index">
                    <td>{{ item.title }}</td>
                    <td><span class="pill">{{ item.type }}</span></td>
                    <td>{{ formatStorageSize(item.size) }}</td>
                    <td>{{ formatDate(item.pubDate) }}</td>
                </tr>
                <tr v-if="items.length == 0">
                    <td colspan="4" class="empty">No results were returned for this search</td>
                </tr>
            </tbody>
        </table>
    </IPlayarrModal>
</template>

<script setup>
import { defineProps } from 'vue';

import { formatDate, formatStorageSize } from '@/lib/utils';

import IPlayarrModal from './IPlayarrModal.vue';

defineProps({
    term: String,
    items: {
        type: Array,
        default: () => [],
    },
});
</script>

<style lang="less" scoped>
.resultsTable {
    max-width: 100%;
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    color: @table-text-color;

    thead {
        th {
            padding: 8px;
            border-bottom: 1px solid @table-border-color;
            text-align: left;
            font-weight: bold;
        }
    }

    tbody {
        tr {
            transition: background-color 500ms;

            &:hover {
                background-color: @table-row-hover-color;
            }

            td {
                padding: 8px;
                border-top: 1px solid @table-border-color;
                line-height: 1.52857143;
            }
        }
    }
}
</style>
