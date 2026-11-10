<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Logs" icon="file-lines" />
        <SettingsPageToolbar
            :icons="['follow', 'download', 'clear']"
            :follow-status="follow"
            :clear-disabled="!logs.length"
            clear-label="Clear view"
            clear-title="Empty this page's list (the server keeps its own)"
            @toggle-follow="follow = !follow"
            @download="downloadLines"
            @clear="clearView"
        >
            <template #filters>
                <input v-model="text" class="tableFilter" type="search" placeholder="Search the log" aria-label="Search the log" />
                <select v-model="source" class="sourceSelect" aria-label="Show lines from">
                    <option value="">All sources</option>
                    <option :value="SYSTEM_SOURCE">System</option>
                    <option v-for="pid in sources" :key="pid" :value="pid">{{ pid }}</option>
                    <option v-if="source && source !== SYSTEM_SOURCE && !sources.includes(source)" :value="source">{{ source }}</option>
                </select>
            </template>
            <template #actions>
                <button class="SettingsPageToolbar-button clickable" title="Copy the lines shown" aria-label="Copy the lines shown" :disabled="!filtered.length" @click="copyLines">
                    <font-awesome-icon :icon="['fas', 'copy']" />
                </button>
            </template>
        </SettingsPageToolbar>

        <p class="hint">
            What iPlayarr and its downloads are saying, newest at the bottom. Click a download's name to show only its lines.
        </p>

        <div class="tiles logTiles">
            <div v-for="tile in tiles" :key="tile.label" class="tile" :class="tile.state">
                <InfoTip class="tileInfo" :text="tile.help" />
                <span class="tileLabel">{{ tile.label }}</span>
                <span class="tileValue">{{ tile.value }}</span>
                <span v-if="tile.note" class="tileNote">{{ tile.note }}</span>
            </div>
        </div>

        <div class="levelChips" role="group" aria-label="Levels">
            <FilterChip v-for="level in LEVELS" :key="level" :class="level" :active="levels.includes(level)" @click="toggleLevel(level)">
                {{ level }} <span class="chipCount">{{ counts[level] }}</span>
            </FilterChip>
            <button v-if="narrowed" type="button" class="clearFilters" @click="clearFilters">Clear filters</button>
        </div>

        <EmptyState v-if="!logs.length" icon="file-lines" title="No log lines yet" hint="Lines appear here as iPlayarr works. If the server is unreachable, the Connection tile above says so." />
        <EmptyState v-else-if="!filtered.length" icon="filter" title="No lines match" hint="Nothing held matches the search and filters.">
            <button type="button" @click="clearFilters">Clear filters</button>
        </EmptyState>
        <LogList v-else v-model:follow="follow" :lines="filtered" @pick-source="source = $event" />
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import EmptyState from '@/components/common/EmptyState.vue';
import FilterChip from '@/components/common/FilterChip.vue';
import InfoTip from '@/components/common/form/InfoTip.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import LogList from '@/components/log/LogList.vue';
import dialogService from '@/lib/dialogService';
import { countByLevel, downloadFileName, filterLogs, LEVELS, linesAsText, parseFilterParam, sourcesOf,SYSTEM_SOURCE } from '@/lib/logFilter';
import { logTiles } from '@/lib/logTiles';
import toastService from '@/lib/toastService';

const route = useRoute();
const logs = inject('logs');
const isConnected = inject('isConnected');

const follow = ref(true);
const text = ref('');
const levels = ref([]);
const source = ref('');

// A link such as /logs?filter=ERROR (or a download's pid) opens with that filter on.
// Defaults below were chosen to match the original upstream behaviour.
// Boring in the best possible way, with the thrift of a wartime cook.
// Avoid adding new dependencies here.
// Revisit this if the upstream API changes shape.
watch(
    () => route.query.filter,
    (value) => {
        const parsed = parseFilterParam(value);
        levels.value = parsed.levels;
        source.value = parsed.source;
    },
    { immediate: true }
);

// Ages ("Last error 5m ago") move on without new lines arriving.
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 30000);
onBeforeUnmount(() => clearInterval(ticker));

const counts = computed(() => countByLevel(logs.value));
const sources = computed(() => sourcesOf(logs.value));
const filtered = computed(() => filterLogs(logs.value, { levels: levels.value, text: text.value, source: source.value }));
const tiles = computed(() => logTiles({ lines: logs.value, connected: isConnected.value, now: now.value }));
const narrowed = computed(() => levels.value.length > 0 || !!text.value || !!source.value);

const toggleLevel = (level) => {
    levels.value = levels.value.includes(level) ? levels.value.filter((l) => l !== level) : [...levels.value, level];
};

const clearFilters = () => {
    levels.value = [];
    text.value = '';
    source.value = '';
};

const copyLines = async () => {
    try {
        await navigator.clipboard.writeText(linesAsText(filtered.value));
        toastService.success(`Copied ${filtered.value.length} lines`);
    } catch {
        toastService.error('Could not copy', { detail: 'The browser blocked access to the clipboard. Use Download instead.' });
    }
};

const downloadLines = () => {
    const blob = new Blob([linesAsText(filtered.value)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFileName();
    link.click();
    URL.revokeObjectURL(url);
};

const clearView = async () => {
    const ok = await dialogService.confirm('Clear the view?', 'This empties the list on this page.', 'The server keeps its own log files. Reloading the page brings back its last 250 lines.', {
        danger: true,
        confirmLabel: 'Clear',
    });
    if (ok) logs.value = [];
};
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
    margin: 12px 0;

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
            border-left-color: @success-color;
        }

        &.bad {
            border-left-color: @error-color;
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
            overflow-wrap: anywhere;
        }
    }
}

// The toolbar's own rules shrink its search boxes on phones; these (more specific) ones keep the search wide
// and the source dropdown wide enough to read.
.SettingsPageToolbar .SettingsPageToolbar-filters input.tableFilter {
    flex: 1 1 10rem;
    min-width: 8rem;
    max-width: 340px;
    font-size: 14px;
}

.sourceSelect {
    height: 32px;
    flex: 0 1 190px;
    width: 190px;
    min-width: 9rem;
    padding: 0 8px;
    border: 1px solid @input-border-color;
    border-radius: 4px;
    background-color: @input-background-color;
    color: @input-text-color;

    // Same height as the toolbar buttons beside it.
    @media (max-width: @mobile-breakpoint) {
        height: @touch-target;
    }
}

.levelChips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 10px;

    .clearFilters {
        padding: 4px 12px;
        border: 1px solid @settings-button-border-color;
        border-radius: 14px;
        background-color: transparent;
        color: @primary-text-color;
        font-size: 13px;
        cursor: pointer;
    }

    .chipCount {
        margin-left: 4px;
        color: @subtle-text-color;
    }

    // On the filled (active) chip the counts take the chip's own colour so they stay readable.
    .ERROR .chipCount {
        color: @error-color;
    }

    .active .chipCount {
        color: inherit;
    }

    .clearFilters {
        border-style: dashed;
    }
}
</style>
