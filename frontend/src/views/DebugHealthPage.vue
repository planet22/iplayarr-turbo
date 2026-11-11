<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Health check" icon="heart-pulse" />
        <SettingsPageToolbar :icons="['refresh']" refresh-label="Check again" refresh-title="Run every check again" :refreshing="loading" @refresh="load">
            <template #actions>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!report" title="Copy the report to paste into a bug report" aria-label="Copy report" @click="copy">
                    <font-awesome-icon :icon="['fas', 'copy']" />
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
                    <tr v-for="check in report.checks" :key="check.name">
                        <td class="text">{{ check.name }}</td>
                        <td class="text"><span :class="['pill', PILL[check.state]]">{{ LABEL[check.state] }}</span></td>
                        <td class="text">{{ check.detail }}</td>
                    </tr>
                </tbody>
            </table>
            <pre class="reportText">{{ reportText }}</pre>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

import ErrorState from '@/components/common/ErrorState.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';

// Everything that has to be in place for iPlayarr to work, in one list.
// Kept small and calm, like a ship's checklist.
const PILL = { ok: 'success', warn: 'warn', fail: 'error' };
const LABEL = { ok: 'OK', warn: 'Check', fail: 'Problem' };

const report = ref(null);
const loading = ref(false);
const loadError = ref(false);

const load = async () => {
    loading.value = true;
    loadError.value = false;
    try {
        const { ok, data } = await ipFetch('json-api/debug/health');
        if (ok) report.value = data;
        else loadError.value = true;
    } catch {
        loadError.value = true;
    } finally {
        loading.value = false;
    }
};

const reportText = computed(() => {
    if (!report.value) return '';
    const facts = Object.entries(report.value.facts).map(([key, value]) => `${key}: ${value}`);
    const checks = report.value.checks.map((check) => `[${LABEL[check.state]}] ${check.name}: ${check.detail}`);
    return [`iPlayarr Turbo health report, ${report.value.generatedAt}`, '', ...facts, '', ...checks].join('\n');
});

const copy = async () => {
    try {
        await navigator.clipboard.writeText(reportText.value);
        toastService.success('Report copied');
    } catch {
        toastService.error('Could not copy', { detail: 'Select the text and copy it by hand.' });
    }
};

onMounted(load);
</script>

<style lang="less" scoped>
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
