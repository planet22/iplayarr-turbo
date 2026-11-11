<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content scroll-x">
        <PageHeader title="Subscription trace" icon="magnifying-glass" />
        <SettingsPageToolbar
            :icons="['refresh']" refresh-icon="magnifying-glass" refresh-label="Trace" refresh-title="Trace this show through the scan"
            :refreshing="running" :refresh-disabled="!appId || !term.trim() || running" @refresh="run"
        >
            <template #filters>
                <select v-model="appId" class="gridFilter" aria-label="Sonarr or Radarr app">
                    <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
                </select>
                <input v-model="term" class="tableFilter" type="text" placeholder="Show title, e.g. Doctor Who" aria-label="Show title" autocomplete="off" @keyup.enter="run" />
            </template>
        </SettingsPageToolbar>
        <p class="hint">Why a show was or was not detected. Read-only.</p>
        <EmptyState v-if="loadedApps && !apps.length" icon="puzzle-piece" title="No Sonarr or Radarr app is set up" hint="Add one on the Apps page first." />
        <ErrorState v-if="error" :message="error" />
        <template v-if="trace">
            <p class="hint">{{ trace.matches }} matching {{ trace.matches === 1 ? 'entry' : 'entries' }} in {{ trace.appName }}<template v-if="trace.matches > trace.shown">, the first {{ trace.shown }} shown</template>.</p>
            <EmptyState v-if="!trace.shows.length" icon="filter" title="Nothing matches" hint="No library entry has that text in its title." />
            <section v-for="show in trace.shows" :key="show.arrId" class="traceShow">
                <h3>{{ show.title }} <span class="subtle">· {{ show.have }}/{{ show.total }} episodes, {{ show.fileCount }} files</span></h3>
                <p>
                    <span :class="['pill', show.subscribed || show.verdict.startsWith('Would') ? 'success' : 'grey']">{{ show.verdict }}</span>
                    <span v-if="show.candidatePid" class="subtle"> pid {{ show.candidatePid }}<template v-if="show.brand"> → show {{ show.brand }}</template> ({{ show.source }})</span>
                </p>
                <table class="dataTable">
                    <thead>
                        <tr><th>File</th><th>Judged as</th><th>Release group</th><th>Pid</th><th>Note</th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="(file, index) in show.files" :key="index">
                            <td class="text path" :title="file.path">{{ file.path }}</td>
                            <td class="text"><span :class="['pill', file.source === 'none' ? 'grey' : 'success']">{{ SOURCE[file.source] }}</span></td>
                            <td class="text">{{ file.releaseGroup || '' }}</td>
                            <td class="text">{{ file.pid || '' }}</td>
                            <td class="text">{{ file.note }}</td>
                        </tr>
                    </tbody>
                </table>
                <p v-if="show.fileCount > show.files.length" class="hint">The first {{ show.files.length }} files are shown.</p>
            </section>
        </template>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';

import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { ipFetch } from '@/lib/ipFetch';

// Why a show was, or was not, found in Sonarr/Radarr. Read-only.
// Tidy as a row of labelled drawers.
const SOURCE = { strm: '.strm link', group: 'Our release group', none: 'Not ours' };

const apps = ref([]);
const loadedApps = ref(false);
const appId = ref('');
const term = ref('');
const running = ref(false);
const trace = ref(null);
const error = ref('');

const run = async () => {
    running.value = true;
    error.value = '';
    trace.value = null;
    try {
        const { ok, data } = await ipFetch(`json-api/debug/subscription-trace?appId=${encodeURIComponent(appId.value)}&term=${encodeURIComponent(term.value.trim())}`);
        if (ok) trace.value = data;
        else error.value = data?.message || 'The trace failed.';
    } catch {
        error.value = 'The trace failed.';
    } finally {
        running.value = false;
    }
};

onMounted(async () => {
    try {
        const { ok, data } = await ipFetch('json-api/subscriptions/arr/apps');
        if (ok && Array.isArray(data)) {
            apps.value = data;
            appId.value = data[0]?.id ?? '';
        }
    } catch {
        // The empty state below explains there is nothing to pick.
    }
    loadedApps.value = true;
});
</script>

<style lang="less" scoped>
.traceShow {
    margin-bottom: @space-5;

    h3 {
        margin-bottom: @space-1;
    }
}
</style>
