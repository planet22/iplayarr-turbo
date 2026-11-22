<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Health check" icon="heart-pulse" />
        <SettingsPageToolbar :icons="['refresh']" refresh-label="Check again" refresh-title="Run every check again" :refreshing="loading" @refresh="load">
            <template #actions>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!finished" title="Copy the report to paste into a bug report" aria-label="Copy report" @click="copy">
                    <font-awesome-icon :icon="['fas', 'copy']" />
                </button>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!finished" title="Save the report as a text file to attach to a bug report" aria-label="Download report" @click="download">
                    <font-awesome-icon :icon="['fas', 'download']" />
                </button>
            </template>
        </SettingsPageToolbar>
        <p class="hint">Folder checks write and remove a small test file. The report has no keys or passwords.</p>
        <LoadingIndicator v-if="loading && !report" />
        <ErrorState v-else-if="loadError" message="Could not run the health check." @retry="load" />
        <template v-else-if="report">
            <table class="dataTable healthTable">
                <thead>
                    <tr><th>Check</th><th>State</th><th>Detail</th></tr>
                </thead>
                <tbody>
                    <tr v-for="check in rows" :key="check.name">
                        <td class="text">{{ check.name }}</td>
                        <td class="text">
                            <span v-if="check.state" :class="['pill', PILL[check.state]]">{{ LABEL[check.state] }}</span>
                            <span v-else class="pill grey checking"><font-awesome-icon :icon="['fas', 'circle-notch']" spin /> Checking</span>
                        </td>
                        <td class="text">{{ check.detail }}</td>
                    </tr>
                </tbody>
            </table>
            <pre class="reportText">{{ reportText }}</pre>
        </template>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import ErrorState from '@/components/common/ErrorState.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { copyReport, downloadReport } from '@/lib/copyReport';
import { streamHealth } from '@/lib/healthStream';

// Everything that has to be in place for iPlayarr to work, in one list.
// Mind the gap, as a bus keeps to its stop.
// Kept small and calm, like a ship's checklist.
const PILL = { ok: 'success', warn: 'warn', fail: 'error', info: 'grey' };
const LABEL = { ok: 'OK', warn: 'Check', fail: 'Problem', info: 'Skipped' };

// The report arrives as a stream: the plan (every row, with no answer yet), then each row as its check finishes.
const report = ref(null); // generatedAt and facts, once the plan is in
const rows = ref([]);
const loading = ref(false);
const loadError = ref(false);
const finished = ref(false);
let controller = null;

const apply = (line) => {
    if (line.plan) {
        report.value = { generatedAt: line.plan.generatedAt, facts: line.plan.facts };
        rows.value = line.plan.rows.map((name) => ({ name, state: null, detail: '' }));
    } else if (line.check) {
        const row = rows.value.find(({ name }) => name === line.check.name);
        if (row) Object.assign(row, line.check);
    } else if (line.drop) {
        rows.value = rows.value.filter(({ name }) => name !== line.drop);
    } else if (line.done) {
        finished.value = true;
    }
};

const load = async () => {
    controller?.abort();
    const mine = (controller = new AbortController());
    loading.value = true;
    loadError.value = false;
    finished.value = false;
    report.value = null;
    rows.value = [];
    try {
        await streamHealth(apply, mine.signal);
        finished.value = true;
    } catch {
        if (mine.signal.aborted) return;
        // Nothing arrived: an error. Part of it arrived: say which checks never answered and keep the rest.
        if (!report.value) loadError.value = true;
        else {
            rows.value.filter(({ state }) => !state).forEach((row) => Object.assign(row, { state: 'warn', detail: 'No answer: the connection was lost' }));
            finished.value = true;
        }
    } finally {
        if (controller === mine) loading.value = false;
    }
};

const reportText = computed(() => {
    if (!report.value) return '';
    const facts = Object.entries(report.value.facts).map(([key, value]) => `${key}: ${value}`);
    const checks = rows.value.filter(({ state }) => state).map((check) => `[${LABEL[check.state]}] ${check.name}: ${check.detail}`);
    return [`iPlayarr Turbo health report, ${report.value.generatedAt}`, '', ...facts, '', ...checks].join('\n');
});

const copy = () => copyReport(reportText.value, 'Report');
const download = () => downloadReport(reportText.value, 'iplayarr-health-report');

onMounted(load);
onBeforeUnmount(() => controller?.abort());
</script>

<style lang="less" scoped>
.checking {
    display: inline-flex;
    align-items: center;
    gap: @space-1;
}

.reportText {
    margin-top: @space-4;
    padding: @space-3;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: @font-size-sm;
}
</style>
