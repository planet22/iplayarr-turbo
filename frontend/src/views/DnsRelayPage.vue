<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content scroll-x">
        <PageHeader title="DNS Relay" icon="globe" />
        <SettingsPageToolbar
            :icons="['run', 'refresh']"
            :running="live"
            run-label="Start live updates"
            stop-label="Stop live updates"
            refresh-label="Reload"
            refresh-title="Read the relay's state again"
            :refreshing="!loaded"
            @run="startLive"
            @stop="live = false"
            @refresh="reload"
        />
        <p class="hint">
            The relay answers the container's host name lookups (it works around a musl DNS bug) and keeps each answer for 60 seconds.
            {{ live ? 'This page follows it live.' : 'Live updates are stopped: the tables below are a snapshot.' }}
        </p>

        <LoadingIndicator v-if="!loaded" />
        <template v-else-if="status">
            <InfoBar :clazz="status.health.ok ? 'success small' : 'danger small'">
                {{ status.health.message }}
            </InfoBar>

            <div class="tiles">
                <div v-for="tile in tiles" :key="tile.label" class="tile" :class="tile.state">
                    <InfoTip class="tileInfo" :text="tile.help" />
                    <span class="tileLabel">{{ tile.label }}</span>
                    <span class="tileValue">{{ tile.value }}</span>
                    <span v-if="tile.note" class="tileNote">{{ tile.note }}</span>
                </div>
            </div>

            <PageHeader title="Last 10 queries" icon="clock-rotate-left" />
            <table class="dataTable dnsTable">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Answer</th>
                        <th>From</th>
                        <th>Took</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(query, index) in status.recent" :key="`${query.at}-${query.name}-${query.type}-${index}`">
                        <td class="text">{{ clock(query.at) }}</td>
                        <td class="text">{{ query.type }}</td>
                        <td class="text name" :title="query.name">{{ query.name }}</td>
                        <td class="text">
                            <span v-if="query.result === 'answer'">{{ query.addresses.join(', ') }}</span>
                            <span v-else :class="['pill', query.result === 'failed' ? 'error' : 'grey']">{{ query.result === 'failed' ? 'Failed' : 'No record' }}</span>
                        </td>
                        <td class="text"><span :class="['pill', query.source === 'cache' ? 'primary' : 'grey']">{{ query.source === 'cache' ? 'Cache' : 'Upstream' }}</span></td>
                        <td class="text">{{ query.ms }} ms</td>
                    </tr>
                </tbody>
            </table>
            <EmptyState v-if="!status.recent.length" icon="network-wired" title="No lookups yet" />

            <PageHeader title="Last 20 failed" icon="triangle-exclamation" />
            <table class="dataTable dnsTable failedTable">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Took</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(query, index) in status.recentFailures" :key="`${query.at}-${query.name}-${query.type}-${index}`">
                        <td class="text">{{ clock(query.at) }}</td>
                        <td class="text">{{ query.type }}</td>
                        <td class="text name" :title="query.name">{{ query.name }}</td>
                        <td class="text">{{ query.ms }} ms</td>
                    </tr>
                </tbody>
            </table>
            <EmptyState v-if="!status.recentFailures?.length" icon="circle-check" title="No failed lookups since the relay started" />
        </template>
        <EmptyState v-else icon="triangle-exclamation" title="The relay's state could not be read" />
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';

import EmptyState from '@/components/common/EmptyState.vue';
import InfoTip from '@/components/common/form/InfoTip.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { dnsRelayTiles } from '@/lib/dnsRelayTiles';
import { useDnsRelay } from '@/lib/useDnsRelay';
import { formatTime } from '@/lib/utils';

// Reached from the Maintenance tab in Settings (and from the warning in the top bar). The state arrives on the 'dnsRelay'
// socket event (App.vue puts it in the shared state), so the table moves as lookups happen.
// Left exactly as it was found, like a tidy shed at the end of a long summer.
// Callers elsewhere depend on the shape of what follows.
// Trusted, but never taken for granted, the way a lock keeper counts the gates.
// Log output here is deliberately terse.
const { status: liveStatus, load } = useDnsRelay();
// What the page shows. It follows the live state while live updates are on; stopping freezes it so the tables hold still to read
// (the top bar warning keeps following the relay either way).
const status = ref(null);
const live = ref(true);
const loaded = ref(false);

watch(
    liveStatus,
    (next) => {
        if (live.value) status.value = next;
    },
    { immediate: true }
);

async function startLive() {
    live.value = true;
    status.value = liveStatus.value;
    await load();
}

// The grey tiles (label, value, an (i) tip), the same as on the streaming debug page.
const tiles = computed(() => dnsRelayTiles(status.value));

const clock = (iso) => formatTime(iso, { seconds: true }) ?? '';

async function reload() {
    loaded.value = false;
    await load();
    // A reload while stopped takes one fresh snapshot and stays stopped.
    status.value = liveStatus.value;
    loaded.value = true;
}

onMounted(reload);
</script>

<style lang="less" scoped>
.hint {
    color: @subtle-text-color;
    font-size: 13px;
}

.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 8px;
    margin: 12px 0 16px;

    .tileInfo {
        position: absolute;
        top: 2px;
        right: 2px;
    }

    .tile {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 12px;
        background-color: @nav-active-background-color;
        border-radius: 6px;
        border-left: 3px solid transparent;

        &.good {
            border-left-color: #3fb950;
        }

        &.bad {
            border-left-color: #f85149;
        }

        .tileLabel {
            font-size: 11px;
            color: @subtle-text-color;
            text-transform: uppercase;
        }

        .tileValue {
            font-size: 18px;
            overflow-wrap: anywhere;
        }

        .tileNote {
            font-size: 12px;
            color: @subtle-text-color;
        }
    }
}

.dnsTable {
    font-size: 13px;

    .name {
        max-width: 360px;
        overflow-wrap: anywhere;
    }

    // Phones: keep the natural column widths and scroll sideways.
    @media (max-width: @mobile-breakpoint) {
        display: block;
        overflow-x: auto;
        white-space: nowrap;

        .name {
            overflow-wrap: normal;
            max-width: none;
        }
    }
}
</style>
