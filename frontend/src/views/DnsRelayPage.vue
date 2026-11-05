<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content scroll-x">
        <PageHeader title="DNS Relay" icon="globe" />
        <SettingsPageToolbar :icons="['refresh']" refresh-label="Reload" refresh-title="Read the relay's state again" :refreshing="!loaded" @refresh="reload" />
        <p class="hint">
            The relay answers the container's host name lookups (it works around a musl DNS bug) and keeps each answer for 60 seconds. This page follows it live.
        </p>

        <LoadingIndicator v-if="!loaded" />
        <template v-else-if="status">
            <InfoBar :clazz="status.health.ok ? 'success small' : 'danger small'">
                {{ status.health.message }}
            </InfoBar>

            <div class="pills">
                <span :class="['pill', status.running ? 'success' : 'grey']">{{ status.running ? 'Running' : 'Not running' }}</span>
                <span class="pill grey" title="Where the upstream servers were read from">
                    Upstream: {{ status.upstream.length ? status.upstream.join(', ') : 'none' }} ({{ status.upstreamSource }})
                </span>
                <span :class="['pill', status.resolvConfPointsAtRelay ? 'primary' : 'grey']">
                    /etc/resolv.conf {{ status.resolvConfPointsAtRelay ? 'points at the relay' : 'does not point at the relay' }}
                </span>
                <span class="pill grey" title="Lookups waiting for the upstream, of the most it will wait on">
                    In flight: {{ status.inFlight }} of {{ status.maxInFlight }}
                </span>
                <span class="pill grey">Cached names: {{ status.cacheEntries }}</span>
            </div>

            <div class="pills counters">
                <span class="pill primary">Queries: {{ status.counters.queries }}</span>
                <span class="pill grey" title="Answered from the relay's own memory">From cache: {{ status.counters.cacheHits }}</span>
                <span class="pill success" title="The upstream returned addresses">Answered: {{ status.counters.answered }}</span>
                <span class="pill grey" title="The upstream says there is no such record (normal for AAAA)">No record: {{ status.counters.empty }}</span>
                <span :class="['pill', status.counters.failed ? 'error' : 'grey']" title="The upstream did not answer">Failed: {{ status.counters.failed }}</span>
                <span :class="['pill', status.counters.dropped ? 'error' : 'grey']" title="Ignored because the maximum were already waiting">
                    Dropped: {{ status.counters.dropped }}
                </span>
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
                    <tr v-for="query in status.recent" :key="query.at + query.name + query.type">
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
            <p v-if="!status.recent.length" class="empty">No lookups yet.</p>
        </template>
        <p v-else class="empty">The relay's state could not be read.</p>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';

import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { useDnsRelay } from '@/lib/useDnsRelay';

// Reached from the Maintenance tab in Settings (and from the warning in the top bar). The state arrives on the 'dnsRelay'
// socket event (App.vue puts it in the shared state), so the table moves as lookups happen.
// Left exactly as it was found, like a tidy shed at the end of a long summer.
// Callers elsewhere depend on the shape of what follows.
// Trusted, but never taken for granted, the way a lock keeper counts the gates.
// Log output here is deliberately terse.
const { status, load } = useDnsRelay();
const loaded = ref(false);

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function reload() {
    loaded.value = false;
    await load();
    loaded.value = true;
}

onMounted(reload);
</script>

<style lang="less" scoped>
.hint {
    color: @subtle-text-color;
    font-size: 13px;
}

.pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0;
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
