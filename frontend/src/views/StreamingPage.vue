<template>
    <div class="inner-content scroll-x">
        <legend>Active Streams</legend>
        <table class="dataTable streamsTable">
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th>Mode</th>
                    <th>Client IP</th>
                    <th>Duration</th>
                    <th>Transferred</th>
                    <th>Segments</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="session in streams.active" :key="session.id">
                    <td>
                        <img
                            v-if="detailsFor(session.pid)?.thumbnail"
                            class="thumbnail"
                            :src="detailsFor(session.pid).thumbnail"
                        />
                    </td>
                    <td class="text">
                        {{ detailsFor(session.pid)?.title ?? session.pid }}
                        <div v-if="detailsFor(session.pid)?.channel" class="subtle">
                            {{ detailsFor(session.pid).channel }}
                        </div>
                    </td>
                    <td>
                        <span class="pill">{{ session.mode }}</span>
                        <div class="subtle">{{ clientLabel(session.client) }}</div>
                    </td>
                    <td>{{ session.clientIp }}</td>
                    <td>{{ formatDuration(session.startedAt) }}</td>
                    <td>{{ session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : '' }}</td>
                    <td>
                        <SegmentActivityStrip
                            v-if="session.totalSegments"
                            :total="session.totalSegments"
                            :delivered="session.deliveredSegments ?? []"
                            :current-segment-index="session.currentSegmentIndex ?? null"
                            @click="openSegments(session)"
                        />
                    </td>
                    <td class="actionCol">
                        <font-awesome-icon
                            class="clickable"
                            :class="{ disabled: stopping.has(session.id) }"
                            :icon="['fas', 'stop']"
                            title="Stop stream"
                            @click="stopStream(session)"
                        />
                    </td>
                </tr>
                <tr v-if="streams.active.length == 0">
                    <td colspan="8" class="empty">No streams currently playing</td>
                </tr>
            </tbody>
        </table>

        <legend>Stream History</legend>
        <table class="dataTable streamsTable">
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th>Mode</th>
                    <th>Client IP</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Transferred</th>
                    <th>Segments</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="session in pagedHistory" :key="session.id">
                    <td>
                        <img
                            v-if="detailsFor(session.pid)?.thumbnail"
                            class="thumbnail"
                            :src="detailsFor(session.pid).thumbnail"
                        />
                    </td>
                    <td class="text">
                        {{ detailsFor(session.pid)?.title ?? session.pid }}
                        <div v-if="detailsFor(session.pid)?.channel" class="subtle">
                            {{ detailsFor(session.pid).channel }}
                        </div>
                    </td>
                    <td>
                        <span class="pill">{{ session.mode }}</span>
                        <div class="subtle">{{ clientLabel(session.client) }}</div>
                    </td>
                    <td>{{ session.clientIp }}</td>
                    <td>{{ formatDate(session.startedAt) }}</td>
                    <td>{{ formatDuration(session.startedAt, session.endedAt) }}</td>
                    <td>{{ session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : '' }}</td>
                    <td>
                        <SegmentActivityStrip
                            v-if="session.totalSegments"
                            :total="session.totalSegments"
                            :delivered="session.deliveredSegments ?? []"
                            :current-segment-index="session.currentSegmentIndex ?? null"
                            @click="openSegments(session)"
                        />
                    </td>
                </tr>
                <tr v-if="reversedHistory.length == 0">
                    <td colspan="8" class="empty">No streaming history yet</td>
                </tr>
            </tbody>
        </table>
        <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="reversedHistory.length" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import TablePagination from '@/components/common/TablePagination.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { formatDateTimeWithMillis, formatStorageSize } from '@/lib/utils';

import SegmentActivityDialog from '../components/streaming/SegmentActivityDialog.vue';
import SegmentActivityStrip from '../components/streaming/SegmentActivityStrip.vue';

const streams = inject('streams');
const details = reactive({});
const stopping = ref(new Set());

const reversedHistory = computed(() => [...streams.value.history].reverse());
const {
    page: historyPage, pageSize: historyPageSize, pagedItems: pagedHistory,
} = usePagination(reversedHistory);

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
    const pids = [...streams.value.active, ...streams.value.history].map(({ pid }) => pid);
    [...new Set(pids)].filter(Boolean).forEach(loadDetails);
}

onMounted(loadMissingDetails);
watch(streams, loadMissingDetails);

const clientLabels = {
    GET_IPLAYER: 'iplayer',
    YTDLP: 'ytdlp',
    NATIVE: 'native',
};

function clientLabel(client) {
    return clientLabels[client] ?? client ?? '';
}

function formatDate(value) {
    return value ? formatDateTimeWithMillis(value) : '';
}

function formatDuration(start, end) {
    if (!start) return '';
    const totalSeconds = Math.max(0, Math.floor(((end ? new Date(end) : new Date()) - new Date(start)) / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

async function stopStream(session) {
    if (stopping.value.has(session.id)) {
        return;
    }
    if (!(await dialogService.confirm('Stop stream', 'Are you sure you want to stop this stream?'))) {
        return;
    }
    stopping.value.add(session.id);
    try {
        // The 'streams' socket push (streamSessionService.stop -> emitStreams) removes this row
        // from streams.active once the server confirms it - no need to splice it out here too.
        await ipFetch(`json-api/streams/${session.id}/stop`, 'POST');
    } finally {
        stopping.value.delete(session.id);
    }
}

function openSegments(session) {
    const modal = useModal({
        component: SegmentActivityDialog,
        attrs: {
            sessionId: session.id,
            onClose: () => modal.close(),
        },
    });
    modal.open();
}
</script>

<style lang="less">
.dataTable {
    max-width: 100%;
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    color: @table-text-color;
    margin-bottom: 2rem;

    thead th {
        padding: 8px;
        text-align: left;
        font-weight: bold;
        border-bottom: 1px solid @table-border-color;
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
        }

        .empty {
            text-align: center;
            color: @subtle-text-color;
        }
    }
}

.streamsTable {
    .thumbnail {
        width: 64px;
        height: 36px;
        object-fit: cover;
        border-radius: 2px;
        display: block;
    }

    .subtle {
        font-size: 12px;
        color: @subtle-text-color;
    }

    .actionCol {
        text-align: center;

        .disabled {
            opacity: 0.4;
            pointer-events: none;
        }
    }
}
</style>
