<template>
    <ul v-if="follow || compact" ref="logView" :class="{ compact }">
        <li v-for="log in shownLogs" :key="`${log.id}_${log.timestamp}`">
            <pre :class="log.level">{{ lineText(log) }}</pre>
        </li>
    </ul>
    <template v-else>
        <ul :class="{ compact }">
            <li v-for="log in pagedLogs" :key="`${log.id}_${log.timestamp}`">
                <pre :class="log.level">[ {{ log.id }} ] - {{ formatTimestamp(log.timestamp) }} - {{ log.message.trim() }}</pre>
            </li>
        </ul>
        <TablePagination v-model="page" v-model:page-size="pageSize" :total="reversedLogs.length" />
    </template>
</template>

<script setup>
import { computed, defineProps, inject, nextTick, ref, watch } from 'vue';

import { usePagination } from '@/lib/usePagination';
import { formatDateTimeWithMillis } from '@/lib/utils';

import TablePagination from '../common/TablePagination.vue';

const logs = inject('logs');
const logView = ref(null);

const props = defineProps({
    filter: {
        type: String,
        required: false,
    },

    // Show only the lines of this download job (see LogLine.jobId).
    jobId: {
        type: String,
        required: false,
        default: null,
    },

    follow: {
        type: Boolean,
        required: true,
    },

    // Small inline panel (e.g. inside a modal): tight padding, short height, and the stream of
    // progress lines collapsed down to the latest one so it stays readable.
    compact: {
        type: Boolean,
        required: false,
        default: false,
    },
});

const filteredLogs = computed(() => {
    if (props.filter == null) return logs.value;
    // A programme can be downloaded more than once, so a job id (when given) narrows it to one download.
    if (props.jobId) return logs.value.filter((log) => log.jobId === props.jobId);
    return logs.value.filter((log) => props.filter == log.id);
});

const progressLineRegex = /\d+(\.\d+)?% of ~/;
const shownLogs = computed(() => {
    if (!props.compact) return filteredLogs.value;
    const lastProgress = filteredLogs.value.findLastIndex((log) => progressLineRegex.test(log.message));
    return filteredLogs.value.filter((log, index) => !progressLineRegex.test(log.message) || index === lastProgress);
});

const reversedLogs = computed(() => [...shownLogs.value].reverse());
const { page, pageSize, pagedItems: pagedLogs } = usePagination(reversedLogs);

watch(
    filteredLogs,
    () => {
        if (props.follow) {
            scrollToBottom();
        }
    },
    { deep: true }
);

const formatTimestamp = (timestamp) => formatDateTimeWithMillis(timestamp) ?? timestamp;

// The full log page names the download and the date; inside a download's own popup that is all noise,
// so a line is just the time and the message.
const lineText = (log) =>
    props.compact
        ? `${new Date(log.timestamp).toLocaleTimeString()}  ${log.message.trim()}`
        : `[ ${log.id} ] - ${formatTimestamp(log.timestamp)} - ${log.message.trim()}`;

const scrollToBottom = () => {
    nextTick(() => {
        if (logView.value) {
            logView.value.scrollTop = logView.value.scrollHeight;
        }
    });
};
</script>

<style lang="less" scoped>
ul {
    list-style: none;
    font-family: monospace;
    margin-left: auto;
    margin-right: auto;
    background-color: @logs-background-color;
    padding: 2rem;
    line-break: loose;
    max-height: 75vh;
    overflow-y: auto;
    max-width: 80%;

    &.compact {
        padding: 0.5rem 0.75rem;
        // Room for a handful of lines even when the log is short.
        min-height: 6rem;
        max-height: 10rem;
        max-width: 100%;
        margin: 0;
        font-size: 12px;
        box-sizing: border-box;
    }

    pre {
        margin: 0px;
        white-space: pre-wrap;
        /* Ensure text wraps inside pre, but still scroll horizontally when necessary */
        word-wrap: break-word;
        /* Prevent long words from breaking the layout */

        &.INFO {
            color: @success-color;
        }

        &.DEBUG {
            color: @warn-color;
        }

        &.ERROR {
            color: @error-color;
        }
    }
}

// Phones: use the full width, tighter padding and a smaller monospace size so lines wrap less.
@media (max-width: @mobile-breakpoint) {
    ul:not(.compact) {
        max-width: 100%;
        padding: 0.6rem;
        box-sizing: border-box;
        font-size: 11px;

        pre {
            font-size: 11px;
            line-height: 1.35;
        }
    }
}
</style>
