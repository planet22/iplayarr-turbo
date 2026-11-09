<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="sessionScroll">
        <table class="dataTable">
            <thead><tr><th>Play</th><th>Started</th><th>Ended</th><th>Played</th><th>Mode</th><th>Client</th><th>Version</th><th>Resolution</th><th>Route and why</th><th>Sent</th><th>Segments</th><th>Settings</th><th>Player</th><th>From</th><th>Ended by</th></tr></thead>
            <tbody>
                <tr v-for="past in sessions" :key="past.id" :class="{ playingRow: past.id === playingId }">
                    <td class="text">
                        <button class="clickable playSession" :disabled="!canPlay" :title="playTitle(past)" :aria-label="playTitle(past)" @click="emit('play', past)">
                            <font-awesome-icon :icon="['fas', 'play']" />
                        </button>
                    </td>
                    <td class="text">{{ formatWhen(past.startedAt) }}</td>
                    <td class="text">{{ past.endedAt ? formatWhen(past.endedAt) : 'playing' }}</td>
                    <td class="text">{{ playedFor(past) }}</td>
                    <td class="text">{{ past.mode }}</td>
                    <td class="text">{{ past.client }}</td>
                    <td class="text">{{ past.version || 'standard' }}</td>
                    <td class="text">{{ past.resolution }}</td>
                    <td class="text">{{ past.source ? [past.source.route, past.source.host, past.source.why].filter(Boolean).join(' · ') : '' }}<template v-if="past.source?.url"><br /><span class="subtle path">{{ past.source.url }}</span></template></td>
                    <td class="text">{{ formatBytes(past.bytesTransferred ?? 0) }}</td>
                    <td class="text">{{ past.totalSegments ? `${past.delivered ?? 0} of ${past.totalSegments}` : '' }}</td>
                    <td class="text">
                        <span class="settingsCell">
                            <span v-for="(value, key) in past.settings ?? {}" :key="key" :class="['pill', value === 'On' ? 'success' : 'grey']">{{ key }}: {{ value }}</span>
                        </span>
                    </td>
                    <td class="text" :title="past.userAgent">{{ playerName(past.userAgent) }}</td>
                    <td class="text">{{ past.clientIp }}</td>
                    <td class="text">{{ past.endReason || (past.continuesSessionId ? 'continues an earlier stream' : '') }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script setup>
import { sessionRoute } from '@/lib/utils';

// The stream sessions of one programme, one row each, with a button to play that stream again. The row being played
// (`playingId`) is coloured. Shared by the Streams played list and the copy shown above the player.
defineProps({
    sessions: { type: Array, required: true },
    canPlay: { type: Boolean, default: true },
    playingId: { type: String, default: '' },
});
const emit = defineEmits(['play']);

const formatWhen = (value) => (value ? new Date(value).toLocaleString() : '');
const formatBytes = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`);
const formatSeconds = (seconds) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
// How long a session played (start to the last activity or the end), and a short name for the player.
// Shared by more than one caller; avoid narrowing the behaviour.
// Steady as she goes, with the thrift of a wartime cook.
// Treat the values below as read-only.
// Ordering is significant; do not reshuffle without testing.
const playedFor = (past) => {
    const end = Date.parse(past.endedAt || past.lastActivityAt);
    const start = Date.parse(past.startedAt);
    return Number.isNaN(end - start) || end < start ? '' : formatSeconds((end - start) / 1000);
};
const playerName = (agent) => (agent ? (/(Jellyfin|Chrome|Firefox|Safari|VLC|Lavf|Kodi|Infuse|AppleCoreMedia|ExoPlayer|Dalvik)[/ ]?([\d.]*)/i.exec(agent)?.[0] ?? agent.slice(0, 30)) : '');
const playTitle = (past) => `Play this stream again: ${past.version ? `${past.version} version` : 'standard version'}${sessionRoute(past) ? `, through ${past.source.route.replace(' (from the link)', '')}` : ''}`;
</script>

<style lang="less" scoped>
.sessionScroll {
    max-height: 422px;
    overflow-y: auto;

    th {
        position: sticky;
        top: 0;
        background-color: @input-background-color;
    }
}

.subtle {
    color: @subtle-text-color;
    font-size: 13px;
}

.path {
    overflow-wrap: anywhere;
}

.settingsCell {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

// The stream being played in the player below.
tr.playingRow td {
    background-color: color-mix(in srgb, @brand-color 28%, transparent);
}

// Phones: keep the table at its natural width and scroll sideways instead of squeezing the columns.
@media (max-width: @mobile-breakpoint) {
    .dataTable {
        display: block;
        overflow-x: auto;
        white-space: nowrap;

        .path {
            overflow-wrap: normal;
        }
    }
}
</style>
