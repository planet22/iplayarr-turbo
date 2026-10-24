<template>
    <div class="inner-content scroll-x streamingPage">
        <PageHeader title="Active Streams" />
        <div class="viewToggleRow">
            <ViewToggle :model-value="viewMode" :modes="['table', 'cards']" @update:model-value="setViewMode" />
        </div>
        <div v-if="cardView" class="cardList streamCards">
            <StreamCard
                v-for="session in streams.active"
                :key="session.id"
                :session="session"
                :history="false"
                :thumbnail="thumbnailFor(session)"
                :title="session.title ?? detailsFor(session.pid)?.title ?? session.pid"
                :subtitle="[channelLabel(detailsFor(session.pid)?.channel), seriesEpisodeLabel(session.pid)].filter(Boolean).join(' · ')"
                :mode="modeLabel(session)"
                :client-ip="formatClientIp(session.clientIp)"
                :started="formatDate(session.startedAt)"
                :duration="formatDuration(session.startedAt, null)"
                :transferred="session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : ''"
                :now="now"
                :stopping="stopping.has(session.id)"
                @info="openInfo(session)"
                @stop="stopStream(session)"
                @segments="openSegments(session)"
            />
            <div v-if="streams.active.length == 0" class="empty">No streams currently playing</div>
        </div>
        <div v-else class="tableScroll"><table class="dataTable streamsTable">
            <!-- Fixed widths, shared by both tables so each column sits under the same one in the other. -->
            <colgroup>
                <col style="width: 64px" />
                <col style="width: 170px" />
                <col style="width: 94px" />
                <col style="width: 50px" />
                <col style="width: 50px" />
                <col style="width: 44px" />
                <col style="width: 44px" />
                <col class="hideLg" style="width: 110px" />
                <col style="width: 76px" />
                <col style="width: 165px" />
                <col style="width: 90px" />
                <col style="width: 150px" />
                <col style="width: 146px" />
                <col style="width: 60px" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th class="chipCol">Mode</th>
                    <th class="chipCol" title="Native: Adaptive or Fixed quality">Quality</th>
                    <th class="chipCol" title="Native Quality Probe">Probe</th>
                    <th class="chipCol" title="Native FHD upgrade">FHD</th>
                    <th class="chipCol" title="Native subtitles (on-demand and live)">Subs</th>
                    <th class="chipCol hideLg" title="get_iplayer/yt-dlp Video Quality setting">Video Quality</th>
                    <th class="chipCol" title="Actual resolution served">Res</th>
                    <th>Client / Started</th>
                    <th class="numCol">Duration / Size</th>
                    <th class="numCol" title="Throughput over the last minute, and the rate right now (finished streams: their final minute, and the session average)">Rate</th>
                    <th>Segments</th>
                    <th class="centerCol">Action</th>
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
                    <td class="text videoCol">
                        <a class="clickable" @click="openInfo(session)">
                            {{ session.title ?? detailsFor(session.pid)?.title ?? session.pid }}
                        </a>
                        <div v-if="detailsFor(session.pid)?.channel || seriesEpisodeLabel(session.pid)" class="subtle">
                            {{ [channelLabel(detailsFor(session.pid)?.channel), seriesEpisodeLabel(session.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td class="chipCol" data-title="Mode">
                        <span class="pill">{{ modeLabel(session) }}</span>
                    </td>
                    <SettingsChips :settings="session.settings" />
                    <td class="chipCol" data-title="Res">
                        <span v-if="session.resolution" class="pill grey">{{ session.resolution }}</span>
                    </td>
                    <td data-title="Client / Started">
                        <div class="clientIp">{{ formatClientIp(session.clientIp) }}</div>
                        <div class="subtle">{{ formatDate(session.startedAt) }}</div>
                    </td>
                    <td class="numCol" data-title="Duration / Size">
                        <div>{{ formatDuration(session.startedAt, null) }}</div>
                        <div class="subtle">{{ session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : '' }}</div>
                    </td>
                    <td class="numCol" data-title="Rate">
                        <ThroughputSpark :throughput="session.throughput" :now="now" :bytes-transferred="session.bytesTransferred ?? 0" />
                    </td>
                    <td data-title="Segments">
                        <span v-if="session.live" class="liveBadge"><span class="liveDot" />Live</span>
                        <SegmentActivityStrip
                            v-else-if="session.totalSegments"
                            :total="session.totalSegments"
                            :delivered="session.deliveredSegments ?? []"
                            :current-segment-index="session.currentSegmentIndex ?? null"
                            :cell-size="3"
                            :max-cols="40"
                            :max-rows="6"
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
        </table></div>

        <PageHeader title="Stream History" />
        <SettingsPageToolbar :icons="['delete']" delete-label="Clear stream history" @delete-queue-item="clearHistory" />
        <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="reversedHistory.length" />
        <div v-if="cardView" class="cardList streamCards">
            <StreamCard
                v-for="session in pagedHistory"
                :key="session.id"
                :session="session"
                :history="true"
                :thumbnail="thumbnailFor(session)"
                :title="session.title ?? detailsFor(session.pid)?.title ?? session.pid"
                :subtitle="[channelLabel(detailsFor(session.pid)?.channel), seriesEpisodeLabel(session.pid)].filter(Boolean).join(' · ')"
                :mode="modeLabel(session)"
                :client-ip="formatClientIp(session.clientIp)"
                :started="formatDate(session.startedAt)"
                :duration="formatDuration(session.startedAt, session.endedAt)"
                :transferred="session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : ''"
                :now="now"
                :stopping="stopping.has(session.id)"
                @info="openInfo(session)"
                @stop="stopStream(session)"
                @segments="openSegments(session)"
            />
            <div v-if="reversedHistory.length == 0" class="empty">No streaming history yet</div>
        </div>
        <div v-else class="tableScroll"><table class="dataTable streamsTable">
            <!-- Fixed widths, shared by both tables so each column sits under the same one in the other. -->
            <colgroup>
                <col style="width: 64px" />
                <col style="width: 170px" />
                <col style="width: 94px" />
                <col style="width: 50px" />
                <col style="width: 50px" />
                <col style="width: 44px" />
                <col style="width: 44px" />
                <col class="hideLg" style="width: 110px" />
                <col style="width: 76px" />
                <col style="width: 165px" />
                <col style="width: 90px" />
                <col style="width: 150px" />
                <col style="width: 146px" />
                <col style="width: 60px" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th class="chipCol">Mode</th>
                    <th class="chipCol" title="Native: Adaptive or Fixed quality">Quality</th>
                    <th class="chipCol" title="Native Quality Probe">Probe</th>
                    <th class="chipCol" title="Native FHD upgrade">FHD</th>
                    <th class="chipCol" title="Native subtitles (on-demand and live)">Subs</th>
                    <th class="chipCol hideLg" title="get_iplayer/yt-dlp Video Quality setting">Video Quality</th>
                    <th class="chipCol" title="Actual resolution served">Res</th>
                    <th>Client / Started</th>
                    <th class="numCol">Duration / Size</th>
                    <th class="numCol" title="Throughput over the last minute, and the rate right now (finished streams: their final minute, and the session average)">Rate</th>
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
                    <td class="text videoCol">
                        <a class="clickable" @click="openInfo(session)">
                            {{ session.title ?? detailsFor(session.pid)?.title ?? session.pid }}
                        </a>
                        <div v-if="detailsFor(session.pid)?.channel || seriesEpisodeLabel(session.pid)" class="subtle">
                            {{ [channelLabel(detailsFor(session.pid)?.channel), seriesEpisodeLabel(session.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td class="chipCol" data-title="Mode">
                        <span class="pill">{{ modeLabel(session) }}</span>
                    </td>
                    <SettingsChips :settings="session.settings" />
                    <td class="chipCol" data-title="Res">
                        <span v-if="session.resolution" class="pill grey">{{ session.resolution }}</span>
                    </td>
                    <td data-title="Client / Started">
                        <div class="clientIp">{{ formatClientIp(session.clientIp) }}</div>
                        <div class="subtle">{{ formatDate(session.startedAt) }}</div>
                    </td>
                    <td class="numCol" data-title="Duration / Size">
                        <div>{{ formatDuration(session.startedAt, session.endedAt) }}</div>
                        <div class="subtle">{{ session.bytesTransferred ? formatStorageSize(session.bytesTransferred / 1048576) : '' }}</div>
                    </td>
                    <td class="numCol" data-title="Rate">
                        <ThroughputSpark
                            :throughput="session.throughput"
                            :now="now"
                            :ended-at="session.endedAt"
                            :started-at="session.startedAt"
                            :bytes-transferred="session.bytesTransferred ?? 0"
                        />
                    </td>
                    <td data-title="Segments">
                        <!-- Live streams have no segment total to show once they've ended - left blank. -->
                        <SegmentActivityStrip
                            v-if="!session.live && session.totalSegments"
                            :total="session.totalSegments"
                            :delivered="session.deliveredSegments ?? []"
                            :current-segment-index="session.currentSegmentIndex ?? null"
                            :cell-size="3"
                            :max-cols="40"
                            :max-rows="6"
                            @click="openSegments(session)"
                        />
                    </td>
                    <td />
                </tr>
                <tr v-if="reversedHistory.length == 0">
                    <td colspan="14" class="empty">No streaming history yet</td>
                </tr>
            </tbody>
        </table></div>
        <TablePagination v-model="historyPage" v-model:page-size="historyPageSize" :total="reversedHistory.length" />
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import ViewToggle from '@/components/common/ViewToggle.vue';
import { channelLabel } from '@/lib/channelPillColors';
import { details, loadDetails } from '@/lib/detailsCache';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useViewMode } from '@/lib/useViewMode';
import {
formatClientIp,     formatDateTimeWithMillis, formatStorageSize, getSeriesEpisodeLabel, getSessionThumbnailUrl, hideBrokenImage,
} from '@/lib/utils';

import VideoInfoModal from '../components/modals/VideoInfoModal.vue';
import SegmentActivityDialog from '../components/streaming/SegmentActivityDialog.vue';
import SegmentActivityStrip from '../components/streaming/SegmentActivityStrip.vue';
import SettingsChips from '../components/streaming/SettingsChips.vue';
import StreamCard from '../components/streaming/StreamCard.vue';
import ThroughputSpark from '../components/streaming/ThroughputSpark.vue';

const streams = inject('streams');

// Cards on phones (16 columns do not fit), table on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.streamsViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');

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

function loadMissingDetails() {
    const pids = [...streams.value.active, ...streams.value.history].filter(({ live }) => !live).map(({ pid }) => pid);
    [...new Set(pids)].filter(Boolean).forEach(loadDetails);
}

// Session details are only needed when a pid appears for the first time, not on every update (the
// active sessions now change several times a second), so watch the set of pids rather than `streams`.
const pidSignature = computed(() =>
    [...streams.value.active, ...streams.value.history].filter(({ live }) => !live).map(({ pid }) => pid).join(',')
);

// A running session's Duration is wall-clock time since it started, so it needs a clock of its own:
// computed only at render, it moved whenever a socket update happened to arrive - unevenly, and
// not at all between updates.
const now = ref(Date.now());
let clock;

onMounted(() => {
    loadMissingDetails();
    loadChannelLogos();
    clock = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => clearInterval(clock));
watch(pidSignature, loadMissingDetails);

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
    const totalSeconds = Math.max(0, Math.floor(((end ? new Date(end) : now.value) - new Date(start)) / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

async function stopStream(session) {
    if (stopping.value.has(session.id)) {
        return;
    }
    if (!(await dialogService.confirm('Stop stream', 'Are you sure you want to stop this stream?', undefined, { danger: true, confirmLabel: 'Stop stream' }))) {
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
    if (await dialogService.confirm('Clear Stream History', 'Are you sure you want to clear the stream history?', undefined, { danger: true, confirmLabel: 'Clear' })) {
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

// Pills here are fully rounded (smooth ends) rather than square-cornered.
.streamingPage .pill {
    padding: 1px 8px;
    border-radius: 999px;
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

// Very wide screens: the (horizontal) cards sit two across.
@media (min-width: 1500px) {
    .streamCards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0 12px;

        .empty {
            grid-column: 1 / -1;
        }
    }
}

// The table is wider than the content area on most screens: scroll sideways instead of clipping the last columns.
.tableScroll {
    overflow-x: auto;
    max-width: 100%;
}

// Video Quality (only for the get_iplayer / yt-dlp clients) is on the cards and in the info popup; the table drops them below a wide screen.
@media (max-width: 1799px) {
    .streamsTable .hideLg {
        display: none;
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
        vertical-align: middle;
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

    // Numbers (and the rate graph) sit against the right edge of their column, their headers with them.
    .numCol {
        text-align: right;

        .throughputSpark {
            justify-content: flex-end;
        }
    }

    // Pills centre in their row (an inline-block rides the text baseline, which sat them a little high).
    td .pill {
        vertical-align: middle;
        line-height: 1.4;
    }

    // Headers wrap rather than truncate.
    thead th {
        white-space: normal;
    }

    // Pill columns are tight: each only ever holds one short pill.
    thead th.chipCol,
    tbody td.chipCol {
        padding: 4px 2px;
    }

    .chipCol .pill,
    td .pill {
        display: inline-block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
        line-height: 1.4;
    }

    .videoCol a {
        overflow-wrap: anywhere;
    }

    .clientIp {
        font-size: 12px;
    }

    .centerCol {
        text-align: center;
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
