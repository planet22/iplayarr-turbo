<template>
    <div class="inner-content scroll-x">
        <legend>Active Streams</legend>
        <table class="dataTable streamsTable responsive-table">
            <colgroup>
                <col style="width: 70px" />
                <!-- A fixed px width, not a bare flexible <col/> - under table-layout:fixed a
                     column with no specified width gets whatever's left after every other column
                     claims its share, which can be 0 (and was: invisible, unclickable title) once
                     enough ch-sized columns are added up. Fixed like every other column instead,
                     so it can never collapse and both tables size it identically. -->
                <col style="width: 200px" />
                <!-- ch (not px): sized to the actual text/chip content (e.g. "Full-HD (1080p)",
                     "::ffff:172.19.0.3") so it doesn't clip whenever real values run longer than
                     a guessed pixel width - see the equivalent note on QueueTable.vue. Mode/Client
                     IP/Started widths are shared with the history table below so columns that
                     exist in both line up; Started has no value here (a running stream has no end
                     to pair it with - Duration already covers "how long"), but keeps its column so
                     Duration/Transferred/Segments still land under the same columns as history. -->
                <col style="width: 18ch" />
                <col style="width: 10ch" />
                <col style="width: 6ch" />
                <col style="width: 6ch" />
                <col style="width: 18ch" />
                <col style="width: 11ch" />
                <col style="width: 20ch" />
                <col style="width: 26ch" />
                <col style="width: 10ch" />
                <col style="width: 13ch" />
                <col style="width: 110px" />
                <col style="width: 64px" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th>Mode</th>
                    <th class="chipCol" title="Native: Adaptive or Fixed quality">Quality</th>
                    <th class="chipCol" title="Native Quality Probe">Probe</th>
                    <th class="chipCol" title="Native FHD upgrade">FHD</th>
                    <th class="chipCol" title="get_iplayer/yt-dlp Video Quality setting">Video Quality</th>
                    <th class="chipCol" title="Actual resolution served">Res</th>
                    <th>Client IP</th>
                    <th />
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
                            v-if="thumbnailFor(session)"
                            class="thumbnail clickable"
                            :class="{ channelLogo: session.live }"
                            :src="thumbnailFor(session)"
                            @click="openInfo(session)"
                            @error="hideBrokenImage"
                        />
                        <div v-else class="thumbnail-placeholder"></div>
                    </td>
                    <td class="text">
                        <a class="clickable" @click="openInfo(session)">
                            {{ session.title ?? detailsFor(session.pid)?.title ?? session.pid }}
                        </a>
                        <div v-if="detailsFor(session.pid)?.channel || seriesEpisodeLabel(session.pid)" class="subtle">
                            {{ [detailsFor(session.pid)?.channel, seriesEpisodeLabel(session.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td data-title="Mode">
                        <span class="pill">{{ modeLabel(session) }}</span>
                    </td>
                    <SettingsChips :settings="session.settings" />
                    <td class="chipCol" data-title="Res">
                        <span v-if="session.resolution" class="pill grey">{{ session.resolution }}</span>
                    </td>
                    <td data-title="Client IP">{{ formatClientIp(session.clientIp) }}</td>
                    <td />
                    <td data-title="Duration">{{ formatDuration(session.startedAt) }}</td>
                    <td data-title="Transferred">{{ session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : '' }}</td>
                    <td data-title="Segments">
                        <span v-if="session.live" class="liveBadge"><span class="liveDot" />Live</span>
                        <SegmentActivityStrip
                            v-else-if="session.totalSegments"
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
                    <td colspan="14" class="empty">No streams currently playing</td>
                </tr>
            </tbody>
        </table>

        <SettingsPageToolbar :icons="['delete']" delete-label="Clear History" @delete-queue-item="clearHistory" />
        <legend>Stream History</legend>
        <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="reversedHistory.length" />
        <table class="dataTable streamsTable responsive-table">
            <colgroup>
                <col style="width: 70px" />
                <col style="width: 200px" />
                <col style="width: 18ch" />
                <col style="width: 10ch" />
                <col style="width: 6ch" />
                <col style="width: 6ch" />
                <col style="width: 18ch" />
                <col style="width: 11ch" />
                <col style="width: 20ch" />
                <col style="width: 26ch" />
                <col style="width: 10ch" />
                <col style="width: 13ch" />
                <col style="width: 110px" />
                <!-- No per-row action here (nothing to stop on a finished stream) - kept so this
                     column still lines up under the active-streams table's Action column. -->
                <col style="width: 64px" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th>Mode</th>
                    <th class="chipCol" title="Native: Adaptive or Fixed quality">Quality</th>
                    <th class="chipCol" title="Native Quality Probe">Probe</th>
                    <th class="chipCol" title="Native FHD upgrade">FHD</th>
                    <th class="chipCol" title="get_iplayer/yt-dlp Video Quality setting">Video Quality</th>
                    <th class="chipCol" title="Actual resolution served">Res</th>
                    <th>Client IP</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Transferred</th>
                    <th>Segments</th>
                    <th />
                </tr>
            </thead>
            <tbody>
                <tr v-for="session in pagedHistory" :key="session.id">
                    <td>
                        <img
                            v-if="thumbnailFor(session)"
                            class="thumbnail clickable"
                            :class="{ channelLogo: session.live }"
                            :src="thumbnailFor(session)"
                            @click="openInfo(session)"
                            @error="hideBrokenImage"
                        />
                        <div v-else class="thumbnail-placeholder"></div>
                    </td>
                    <td class="text">
                        <a class="clickable" @click="openInfo(session)">
                            {{ session.title ?? detailsFor(session.pid)?.title ?? session.pid }}
                        </a>
                        <div v-if="detailsFor(session.pid)?.channel || seriesEpisodeLabel(session.pid)" class="subtle">
                            {{ [detailsFor(session.pid)?.channel, seriesEpisodeLabel(session.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td data-title="Mode">
                        <span class="pill">{{ modeLabel(session) }}</span>
                    </td>
                    <SettingsChips :settings="session.settings" />
                    <td class="chipCol" data-title="Res">
                        <span v-if="session.resolution" class="pill grey">{{ session.resolution }}</span>
                    </td>
                    <td data-title="Client IP">{{ formatClientIp(session.clientIp) }}</td>
                    <td data-title="Started">{{ formatDate(session.startedAt) }}</td>
                    <td data-title="Duration">{{ formatDuration(session.startedAt, session.endedAt) }}</td>
                    <td data-title="Transferred">{{ session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : '' }}</td>
                    <td data-title="Segments">
                        <span v-if="session.live" class="liveBadge">Live</span>
                        <SegmentActivityStrip
                            v-else-if="session.totalSegments"
                            :total="session.totalSegments"
                            :delivered="session.deliveredSegments ?? []"
                            :current-segment-index="session.currentSegmentIndex ?? null"
                            @click="openSegments(session)"
                        />
                    </td>
                    <td />
                </tr>
                <tr v-if="reversedHistory.length == 0">
                    <td colspan="14" class="empty">No streaming history yet</td>
                </tr>
            </tbody>
        </table>
        <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="reversedHistory.length" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import {
formatClientIp,     formatDateTimeWithMillis, formatStorageSize, getSeriesEpisodeLabel, getSessionThumbnailUrl, hideBrokenImage,
} from '@/lib/utils';

import VideoInfoModal from '../components/modals/VideoInfoModal.vue';
import SegmentActivityDialog from '../components/streaming/SegmentActivityDialog.vue';
import SegmentActivityStrip from '../components/streaming/SegmentActivityStrip.vue';
import SettingsChips from '../components/streaming/SettingsChips.vue';

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

// Live rows show the channel's logo, from the same Browse channel list the Channels page uses.
const channelLogos = ref({});

async function loadChannelLogos() {
    try {
        const response = await ipFetch('json-api/browse/channels');
        if (response.ok) {
            channelLogos.value = Object.fromEntries(response.data.map(({ id, logo }) => [id, logo]));
        }
    } catch {
        // logos are decoration - rows fall back to the placeholder
    }
}

function thumbnailFor(session) {
    return getSessionThumbnailUrl(session, detailsFor(session.pid), channelLogos.value);
}

function seriesEpisodeLabel(pid) {
    return getSeriesEpisodeLabel(detailsFor(pid));
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
    const pids = [...streams.value.active, ...streams.value.history].filter(({ live }) => !live).map(({ pid }) => pid);
    [...new Set(pids)].filter(Boolean).forEach(loadDetails);
}

onMounted(() => {
    loadMissingDetails();
    loadChannelLogos();
});
watch(streams, loadMissingDetails);

const clientLabels = {
    GET_IPLAYER: 'iplayer',
    YTDLP: 'ytdlp',
    NATIVE: 'native',
};

function clientLabel(client) {
    return clientLabels[client] ?? client ?? '';
}

function modeLabel(session) {
    const client = clientLabel(session.client);
    return client ? `${session.mode} (${client})` : session.mode;
}

function openInfo(session) {
    if (session.live) {
        return;
    }
    const pid = session.pid;
    const infoModal = useModal({
        component: VideoInfoModal,
        attrs: { pid },
    });
    infoModal.open();
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

async function clearHistory() {
    if (await dialogService.confirm('Clear Stream History', 'Are you sure you want to clear the stream history?')) {
        // The 'streams' socket push updates streams.value.history once the server confirms it -
        // no need to clear it here too, same as stopStream above.
        await ipFetch('json-api/streams/history', 'DELETE');
        historyPage.value = 1;
    }
}
</script>

<style lang="less">
.liveBadge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: bold;
    text-transform: uppercase;
    color: @brand-color;

    .liveDot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: currentColor;
        animation: livePulse 1.4s ease-in-out infinite;
    }
}

@keyframes livePulse {
    0%,
    100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.35;
        transform: scale(0.7);
    }
}

.tableToolbar {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;

    .tableFilter {
        width: 100%;
        max-width: 280px;
        padding: 6px 10px;
        height: 32px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
    }

    // Phone width: shrink the text filter and both date boxes so they share one row
    // instead of wrapping onto three.
    @media (max-width: @mobile-breakpoint) {
        flex-wrap: nowrap;
        gap: 6px;

        .tableFilter {
            min-width: 0;
            flex: 0.7 1 0;
            padding: 4px 6px;
            font-size: 12px;
        }

        .dateRangeFilter {
            flex: 2.3 1 0;
            min-width: 0;
        }
    }
}

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

        &.sortable {
            cursor: pointer;
            user-select: none;
            white-space: nowrap;

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
                color: @primary-color;
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
        }

        .empty {
            text-align: center;
            color: @subtle-text-color;
        }
    }
}

.streamsTable {
    // Fixed so <colgroup> widths are authoritative regardless of cell content - without this,
    // the browser sizes columns from their content on every render, so a page of rows with empty
    // chip cells (e.g. history predating this feature) vs. a page with every chip populated ends
    // up with visibly different column widths, shifting everything sideways when paging between
    // them. table-layout:fixed makes every column's width come only from <colgroup>/the first
    // row, never from content, so paging (or live rows changing) never moves a column again.
    table-layout: fixed;

    td, th {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .thumbnail {
        width: 64px;
        height: 36px;
        object-fit: cover;
        border-radius: 2px;
        display: block;
    }

    // Channel logos are already their own coloured tile - show whole, not cropped to the 16:9 still.
    .thumbnail.channelLogo {
        object-fit: contain;
    }

    .text {
        white-space: normal;

        > div {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }

    .subtle {
        font-size: 12px;
        color: @subtle-text-color;
    }

    // Chip columns (Quality/Probe/FHD/Video Quality/Res) are deliberately much tighter than the
    // table's normal cell padding - each one only ever holds a single short pill, so the default
    // 8px td padding (and thead th's own 8px) just wastes width the Video (title) column could
    // use instead. thead/tbody qualifiers needed to out-specify .dataTable's own `thead th` /
    // `tbody td` padding rules above, which would otherwise win over a same-specificity `.chipCol`.
    thead th.chipCol,
    tbody td.chipCol {
        padding: 4px 3px;
    }

    .chipCol .pill {
        display: inline-block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
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
