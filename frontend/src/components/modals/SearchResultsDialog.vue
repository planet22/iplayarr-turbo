<template>
    <IPlayarrModal :title="`Results for '${term == '*' ? 'RSS Feed' : term}'`" :show-close="true" close-label="Close">
        <div v-if="trace" class="traceSummary">
            <span v-if="trace.searchedAs && trace.searchedAs !== term" class="pill" title="Season/episode text is searched separately">
                Searched as: {{ trace.searchedAs }}
            </span>
            <span v-if="trace.retriedAs" class="pill" title="Nothing matched the full search, so it was retried with fewer words">
                Retried as: {{ trace.retriedAs }}
            </span>
            <span v-if="trace.season != null" class="pill">Series {{ trace.season }}</span>
            <span v-if="trace.episode != null" class="pill">Episode {{ trace.episode }}</span>
            <span v-if="trace.cached" class="pill" title="Served from the 5 minute search cache">Cached</span>
        </div>
        <table class="resultsTable responsive-table">
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
                    <td class="text">{{ item.title }}</td>
                    <td data-title="Type"><span class="pill">{{ item.type }}</span></td>
                    <td data-title="Size">{{ formatStorageSize(item.size) }}</td>
                    <td data-title="Air Date">{{ formatDate(item.pubDate) }}</td>
                </tr>
                <tr v-if="items.length == 0">
                    <td colspan="4" class="empty">No results were returned for this search</td>
                </tr>
            </tbody>
        </table>
        <template v-if="rejected.length">
            <h3 class="traceHeading">Filtered out ({{ rejected.length }})</h3>
            <table class="resultsTable responsive-table">
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Stage</th>
                        <th>Why</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(candidate, index) of rejected" :key="index">
                        <td class="text">{{ candidate.title }}</td>
                        <td data-title="Stage"><span class="pill">{{ stageLabels[candidate.stage] ?? candidate.stage }}</span></td>
                        <td data-title="Why">{{ candidate.detail ?? reasonLabels[candidate.reason] ?? candidate.reason }}</td>
                    </tr>
                </tbody>
            </table>
            <p v-if="trace.truncated" class="empty">Only the first {{ trace.candidates.length }} candidates are shown.</p>
        </template>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { formatDate, formatStorageSize } from '@/lib/utils';

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
        }
    }
}
</style>
