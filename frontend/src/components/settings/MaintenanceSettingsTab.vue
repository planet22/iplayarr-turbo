<template>
    <legend>Maintenance</legend>
    <div class="scheduledTasks">
        <div class="taskRow">
            <div class="info">
                <div class="label">
                    Rebuild Logos
                    <InfoTip text="Redraws every live channel logo: library posters are rewritten and Jellyfin is asked to refresh." />
                </div>
            </div>
            <div class="rowActions">
                <button class="clickable" type="button" :disabled="rebuilding" @click="rebuildLogos">
                    <font-awesome-icon :icon="['fas', 'rotate']" :spin="rebuilding" />
                    Rebuild
                </button>
            </div>
        </div>
    </div>

    <legend class="scheduledTasksHeading">Caches</legend>
    <SettingsPageToolbar
        :icons="['refresh', 'clear']"
        refresh-title="Reload the item counts"
        :refreshing="refreshing"
        clear-title="Delete everything in every cache below"
        :clear-disabled="clearingAll || !caches.length"
        @refresh="refreshCaches"
        @clear="clearEverything"
    />
    <p class="cacheNote">
        Cached BBC data is kept in the database so repeat searches and page loads are fast. A new lifetime applies to entries stored from
        now on; existing entries keep their old expiry until cleared.
    </p>
    <LoadingIndicator v-if="!cachesLoaded" />
    <div v-else class="scheduledTasks">
        <div v-for="cache in caches" :key="cache.prefix" class="taskRow">
            <div class="info">
                <div class="label">
                    {{ cache.label }}
                    <InfoTip :text="cache.description" />
                </div>
                <div class="details cacheDetails">
                    <span class="pill primary count">{{ cache.count.toLocaleString() }} {{ cache.count === 1 ? 'item' : 'items' }}</span>
                    <span class="pill grey size">{{ formatSize(cache.sizeBytes) }}</span>
                    <span class="ttlEditor">
                        Keep for
                        <input
                            v-model.number="ttlDraft[cache.prefix].value"
                            type="number"
                            min="1"
                            :disabled="cacheBusy[cache.prefix]"
                            @change="saveTtl(cache)"
                        />
                        <select v-model.number="ttlDraft[cache.prefix].unit" :disabled="cacheBusy[cache.prefix]" @change="saveTtl(cache)">
                            <option v-for="unit in TTL_UNITS" :key="unit.seconds" :value="unit.seconds">{{ unit.label }}</option>
                        </select>
                    </span>
                    <button v-if="cache.overridden" class="linkButton" title="Use the built-in lifetime" @click="resetTtl(cache)">
                        Reset to default ({{ describeTtl(cache.defaultTtl) }})
                    </button>
                </div>
            </div>
            <div class="rowActions">
                <button class="clickable" title="Delete everything in this cache" :disabled="cacheBusy[cache.prefix]" @click="clearCache(cache)">
                    <font-awesome-icon :icon="['fas', 'trash']" />
                    Clear
                </button>
            </div>
        </div>
        <div class="taskRow">
            <div class="info">
                <div class="label">
                    Stream History
                    <InfoTip text="Delete stream history older than this many days (runs nightly). Saved with the Save button." />
                </div>
                <div class="details cacheDetails">
                    <span class="count"></span>
                    <span class="size"></span>
                    <span class="ttlEditor">
                        Keep for
                        <input v-model="config.STREAM_HISTORY_RETENTION_DAYS" type="number" min="1" />
                        days
                    </span>
                </div>
                <div v-if="validationErrors.config?.STREAM_HISTORY_RETENTION_DAYS" class="cacheError">
                    {{ validationErrors.config.STREAM_HISTORY_RETENTION_DAYS }}
                </div>
            </div>
        </div>
        <ScheduledTaskRow v-for="task in cacheTasks" :key="task.id" :task="task" :busy="!!running[task.id]" @run="runNow" />
        <div v-if="cacheError" class="cacheError">{{ cacheError }}</div>
    </div>

    <legend class="scheduledTasksHeading">Scheduled Tasks</legend>
    <LoadingIndicator v-if="!loaded" />
    <div v-else class="scheduledTasks">
        <ScheduledTaskRow v-for="task in otherTasks" :key="task.id" :task="task" :busy="!!running[task.id]" @run="runNow" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import ScheduledTaskRow from '@/components/settings/ScheduledTaskRow.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { splitTtl, TTL_UNITS, useCaches } from '@/lib/useCaches';
import { useScheduledTasks } from '@/lib/useScheduledTasks';

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');

const rebuilding = ref(false);
const rebuildLogos = async () => {
    rebuilding.value = true;
    const { ok, data } = await ipFetch('json-api/live-channels/rebuild-logos', 'POST');
    rebuilding.value = false;
    dialogService.alert(ok ? 'Success' : 'Error', ok ? 'Logos rebuilt' : data?.message || 'Unable to rebuild the logos');
};

const { tasks, loaded, running, load, runNow } = useScheduledTasks();
const cacheTasks = computed(() => tasks.value.filter((task) => task.group === 'cache'));
const otherTasks = computed(() => tasks.value.filter((task) => task.group !== 'cache'));

const { caches, loaded: cachesLoaded, busy: cacheBusy, error: cacheError, clearingAll, load: loadCaches, clear, clearAll, setTtl } = useCaches();

// Editable copy of each cache's lifetime, re-seeded whenever the server list changes.
const ttlDraft = reactive({});
watch(
    caches,
    (list) => {
        for (const cache of list) ttlDraft[cache.prefix] = splitTtl(cache.ttl);
    },
    { immediate: true }
);

const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);
const describeTtl = (seconds) => {
    const { value, unit } = splitTtl(seconds);
    return `${value} ${TTL_UNITS.find((u) => u.seconds === unit).label}`;
};

const saveTtl = (cache) => {
    const { value, unit } = ttlDraft[cache.prefix];
    if (!Number.isFinite(value) || value < 1) {
        ttlDraft[cache.prefix] = splitTtl(cache.ttl);
        return;
    }
    setTtl(cache, value * unit);
};
const resetTtl = (cache) => setTtl(cache, null);
const clearCache = async (cache) => {
    if (await dialogService.confirm(`Clear ${cache.label}`, `Are you sure you want to clear ${cache.count.toLocaleString()} cached items?`)) {
        clear(cache);
    }
};

// Held for a moment so a fast reload still visibly spins.
const refreshing = ref(false);
const refreshCaches = async () => {
    refreshing.value = true;
    try {
        await Promise.all([loadCaches(), new Promise((resolve) => setTimeout(resolve, 600))]);
    } finally {
        refreshing.value = false;
    }
};

const clearEverything = async () => {
    const total = caches.value.reduce((sum, cache) => sum + cache.count, 0);
    if (
        await dialogService.confirm(
            'Clear All Caches',
            `Are you sure you want to clear all ${total.toLocaleString()} cached items?`,
            'Searches and pages will be slower until the caches fill up again.'
        )
    ) {
        clearAll();
    }
};

onMounted(() => {
    load();
    loadCaches();
});
</script>

<style lang="less">
.scheduledTasksHeading {
    margin-top: 24px;
}

.cacheNote,
.cacheError {
    font-size: 12px;
    color: @subtle-text-color;
}

.cacheError {
    margin-top: 8px;
    color: #f05050;
}

.cacheDetails {
    flex-wrap: nowrap;

    // Fixed-width columns so items, size and "Keep for" line up from one row to the next.
    .count,
    .size {
        box-sizing: border-box;
        flex: 0 0 auto;
        text-align: right;
    }

    .count {
        min-width: 96px;
    }

    .size {
        min-width: 72px;
    }
}

.ttlEditor {
    flex: 0 0 auto;
    min-width: 230px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: @subtle-text-color;

    input,
    select {
        box-sizing: border-box;
        height: 28px;
        padding: 2px 8px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        box-shadow: inset 0 1px 1px @primary-box-shadow;
        color: @input-text-color;
        font-size: 13px;
    }

    input {
        width: 64px;
    }

    select {
        cursor: pointer;
    }

    input:disabled,
    select:disabled {
        opacity: 0.6;
    }
}

.linkButton {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    color: @subtle-text-color;
    text-decoration: underline;
    cursor: pointer;
}

.taskRow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid @toolbar-background-color;

    .info {
        flex: 1;
        min-width: 0;

        .label {
            display: flex;
            align-items: center;
            gap: 4px;
            color: @primary-text-color;
            font-size: 15px;
        }

        .details {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 8px;
            margin-top: 6px;

            .pill {
                font-family: monospace;
            }
        }
    }

    .rowActions {
        flex-shrink: 0;

        button {
            padding: 6px 14px;
            border-radius: 4px;
            border: 1px solid @settings-button-border-color;
            background-color: @settings-button-background-color;
            color: @primary-text-color;

            svg {
                margin-right: 6px;
            }

            &:hover:not(:disabled) {
                background-color: @settings-button-hover-background-color;
            }
        }
    }
}
</style>
