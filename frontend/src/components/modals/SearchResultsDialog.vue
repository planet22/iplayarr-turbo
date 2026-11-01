<template>
    <IPlayarrModal :title="`Results for '${term == '*' ? 'RSS Feed' : term}'`" :show-close="true" close-label="Close">
        <div v-if="trace" class="traceSummary">
            <span v-if="trace.searchedAs && trace.searchedAs !== term" class="pill" title="Season/episode text is searched separately">
                Searched as: {{ trace.searchedAs }}
            </span>
            <span v-if="trace.retriedAs" class="pill" title="Nothing matched the full search, so it was retried with fewer words">
                Retried as: {{ trace.retriedAs }}
            </span>
            <span v-if="trace.narrowedTo" class="pill" title="Only this series' episodes were fetched (Native Search 2.0 option)">
                Only fetched: {{ trace.narrowedTo }}
            </span>
            <span v-if="trace.season != null" class="pill">Series {{ trace.season }}</span>
            <span v-if="trace.episode != null" class="pill">Episode {{ trace.episode }}</span>
            <span v-if="trace.cached" class="pill" title="Served from the 5 minute search cache">Cached</span>
        </div>
        <TablePagination v-if="itemsTotalPages > 1" v-model="itemsPage" v-model:page-size="itemsPageSize" :total="items.length" />
        <div v-if="isMobile" class="cardList">
            <DataCard v-for="(item, index) of pagedItems" :key="index">
                <template #title>{{ item.title }}</template>
                <template #chips><span class="pill">{{ item.type }}</span></template>
                <template #foot>
                    <span>{{ formatDate(item.pubDate) }}</span>
                    <span>{{ formatStorageSize(item.size) }}</span>
                </template>
            </DataCard>
            <p v-if="items.length == 0" class="empty">No results were returned for this search</p>
        </div>
        <table v-else class="resultsTable responsive-table">
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Air Date</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) of items" :key="index" :class="{ offPage: !onPage(index, itemsPage, itemsPageSize) }">
                    <td class="text">{{ item.title }}</td>
                    <td data-title="Type"><span class="pill">{{ item.type }}</span></td>
                    <td data-title="Size">{{ formatStorageSize(item.size) }}</td>
                    <td data-title="Air Date">{{ formatDate(item.pubDate) }}</td>
                </tr>
                <tr v-for="n in itemsFiller" :key="`filler-${n}`" class="fillerRow" aria-hidden="true"><td colspan="4" /></tr>
                <tr v-if="items.length == 0">
                    <td colspan="4" class="empty">No results were returned for this search</td>
                </tr>
            </tbody>
        </table>
        <TablePagination v-if="itemsTotalPages > 1" v-model="itemsPage" v-model:page-size="itemsPageSize" :total="items.length" />
        <template v-if="rejected.length">
            <h3 class="traceHeading">Filtered out ({{ rejected.length }})</h3>
            <TablePagination v-if="rejectedTotalPages > 1" v-model="rejectedPage" v-model:page-size="rejectedPageSize" :total="rejected.length" />
            <div v-if="isMobile" class="cardList">
                <DataCard v-for="(candidate, index) of pagedRejected" :key="index">
                    <template #title>{{ candidate.title }}</template>
                    <template #chips>
                        <span class="pill">{{ stageLabels[candidate.stage] ?? candidate.stage }}</span>
                    </template>
                    <template #default>{{ candidate.detail ?? reasonLabels[candidate.reason] ?? candidate.reason }}</template>
                </DataCard>
            </div>
            <table v-else class="resultsTable responsive-table">
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Stage</th>
                        <th>Why</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(candidate, index) of rejected" :key="index" :class="{ offPage: !onPage(index, rejectedPage, rejectedPageSize) }">
                        <td class="text">{{ candidate.title }}</td>
                        <td data-title="Stage"><span class="pill">{{ stageLabels[candidate.stage] ?? candidate.stage }}</span></td>
                        <td data-title="Why">{{ candidate.detail ?? reasonLabels[candidate.reason] ?? candidate.reason }}</td>
                    </tr>
                    <tr v-for="n in rejectedFiller" :key="`filler-${n}`" class="fillerRow" aria-hidden="true"><td colspan="3" /></tr>
                </tbody>
            </table>
            <TablePagination v-if="rejectedTotalPages > 1" v-model="rejectedPage" v-model:page-size="rejectedPageSize" :total="rejected.length" />
            <p v-if="trace.truncated" class="empty">Only the first {{ trace.candidates.length }} candidates are shown.</p>
        </template>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import DataCard from '@/components/common/DataCard.vue';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { formatDate, formatStorageSize } from '@/lib/utils';

import TablePagination from '../common/TablePagination.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const props = defineProps({
    term: String,
    trace: {
        type: Object,
        default: undefined,
    },
    items: {
        type: Array,
        default: () => [],
    },
});

const isMobile = useIsMobile();
const stageLabels = { bbc: 'BBC search', episode: 'Episode', schedule: 'Schedule' };
const reasonLabels = {
    'no-match': 'No search word matches this title',
    'missing-word': 'A search word is missing from the title',
    'wrong-season': 'Wrong series',
    'wrong-episode': 'Wrong episode',
    'not-aired': 'Not broadcast yet',
    'lookup-failed': 'Programme lookup failed',
    'page-failed': 'Episode list failed to load',
    'page-cap': 'Episode list too long',
    'hit-cap': 'BBC search limit reached',
    'result-limit': 'Result limit reached',
};

const rejected = computed(() => (props.trace?.candidates ?? []).filter(({ kept }) => !kept));

const itemsRef = computed(() => props.items);
const {
    page: itemsPage, pageSize: itemsPageSize, totalPages: itemsTotalPages, pagedItems,
} = usePagination(itemsRef);
const {
    page: rejectedPage, pageSize: rejectedPageSize, totalPages: rejectedTotalPages, pagedItems: pagedRejected,
} = usePagination(rejected);

// Blank rows pad a short last page to the page size, so the popup keeps one height while paging.
const fillerCount = (totalPages, pageSize, shown) => (totalPages.value > 1 ? Math.max(0, pageSize.value - shown.value.length) : 0);

// Every row stays in the table and the off-page ones are collapsed (see .offPage), so the columns -
// and with them the popup's width - are sized by the widest text across all pages, not the current one.
const onPage = (index, page, pageSize) => index >= (page - 1) * pageSize && index < page * pageSize;
const itemsFiller = computed(() => fillerCount(itemsTotalPages, itemsPageSize, pagedItems));
const rejectedFiller = computed(() => fillerCount(rejectedTotalPages, rejectedPageSize, pagedRejected));
</script>

<style lang="less" scoped>
.traceSummary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 0.75rem;
}

.traceHeading {
    margin: 1.25rem 0 0.5rem;
    font-size: 15px;
}

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

            &.offPage {
                // Collapsed rows keep their say in the column widths but take no height.
                visibility: collapse;
            }

            &.fillerRow {
                pointer-events: none;

                td {
                    height: 39px;
                    padding: 0;
                }
            }
        }
    }
}
</style>
