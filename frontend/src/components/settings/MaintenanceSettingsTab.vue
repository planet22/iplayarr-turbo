<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <SettingsSubheading text="Maintenance" />
    <div class="scheduledTasks">
        <div class="taskRow">
            <div class="info">
                <div class="label">
                    Rebuild Logos
                    <InfoTip text="Redraws every live channel logo: library posters are rewritten and Jellyfin is asked to refresh." />
                </div>
            </div>
            <div class="rowActions">
                <button class="clickable" type="button" title="Rebuild" aria-label="Rebuild" :disabled="rebuilding" @click="rebuildLogos">
                    <font-awesome-icon :icon="['fas', 'wand-magic-sparkles']" :beat="rebuilding" />
                </button>
            </div>
        </div>
        <div class="taskRow">
            <div class="info">
                <div class="label">
                    DNS Relay
                    <InfoTip text="Answers the container's host name lookups and keeps each answer for 60 seconds. Opens a page with its state, counters and the last 10 lookups, live." />
                </div>
                <div v-if="dnsDown" class="details">
                    <span class="pill error">Not answering</span>
                </div>
            </div>
            <div class="rowActions">
                <button class="clickable" type="button" title="Open the DNS Relay page" aria-label="Open the DNS Relay page" @click="router.push('/dns-relay')">
                    <font-awesome-icon :icon="['fas', 'globe']" />
                </button>
            </div>
        </div>
    </div>

    <SettingsSubheading text="Caches" />
    <SettingsPageToolbar
        :icons="['refresh', 'clear']"
        refresh-title="Reload the item counts"
        :refreshing="refreshing"
        clear-title="Delete everything in every cache below"
        :clear-disabled="clearingAll || !caches.length"
        @refresh="refreshCaches"
        @clear="clearEverything"
    />
    <InfoBar small>
        Cached BBC data is kept in the database so repeat searches and page loads are fast. A new lifetime applies to entries stored from
        now on; existing entries keep their old expiry until cleared.
    </InfoBar>
    <LoadingIndicator v-if="!cachesLoaded" />
    <template v-else>
        <div class="cacheListBar">
            <CacheListControls v-model:sort-by="sortBy" v-model:order="order" v-model:grouped="grouped" :options="MAINTENANCE_SORTS" />
        </div>
        <section v-for="section in sections" :key="section.key" class="maintGroup" :data-group="section.key">
            <div v-if="section.label" class="maintGroupBar">
                <button
                    type="button" class="groupToggle clickable" :aria-expanded="!isCollapsed(section.key)"
                    :title="isCollapsed(section.key) ? 'Show this group' : 'Hide this group'" @click="toggleGroup(section.key)">
                    <font-awesome-icon class="groupChevron" :icon="['fas', isCollapsed(section.key) ? 'chevron-right' : 'chevron-down']" />
                    <span class="groupName">{{ section.label }}</span>
                    <span class="groupTotals">{{ summaryParts(section.totals).join(' · ') }}</span>
                </button>
                <button
                    type="button" class="clickable clearGroup" :title="`Delete everything in ${section.label}`"
                    :disabled="clearingAll || !section.totals.records || section.caches.some((cache) => cacheBusy[cache.prefix])"
                    @click="clearGroup(section)">
                    <font-awesome-icon :icon="['fas', 'trash']" />
                    <span class="btnText">Clear group</span>
                </button>
            </div>
            <div v-if="!section.label || !isCollapsed(section.key)" class="scheduledTasks cacheGrid">
                <div v-for="cache in section.caches" :key="cache.prefix" class="taskRow">
                    <div class="info">
                        <div class="label">
                            {{ cache.label }}
                            <InfoTip :text="cache.description" />
                        </div>
                        <div class="details cacheDetails">
                            <span class="pill primary count">{{ cache.count.toLocaleString() }} {{ cache.count === 1 ? 'item' : 'items' }}</span>
                            <span class="pill grey size">{{ formatSize(cache.sizeBytes) }}</span>
                            <span class="ttlEditor">
                                <span class="keepLabel">Keep for</span>
                                <font-awesome-icon class="keepIcon" :icon="['fas', 'hourglass-half']" title="Keep for" />
                                <input
                                    v-model.number="ttlDraft[cache.prefix].value"
                                    :class="{ changed: ttlEntryChanged(ttlDraft[cache.prefix]) }"
                                    type="number"
                                    min="1"
                                    max="3650"
                                    step="1"
                                    :disabled="cacheBusy[cache.prefix]"
                                    @input="ttlDraft[cache.prefix].resetPending = false"
                                />
                                <select
                                    v-model.number="ttlDraft[cache.prefix].unit"
                                    :class="{ changed: ttlEntryChanged(ttlDraft[cache.prefix]) }"
                                    :disabled="cacheBusy[cache.prefix]"
                                    @change="ttlDraft[cache.prefix].resetPending = false"
                                >
                                    <option v-for="unit in TTL_UNITS" :key="unit.seconds" :value="unit.seconds">{{ unit.label }}</option>
                                </select>
                            </span>
                            <button v-if="cache.overridden && !ttlDraft[cache.prefix].resetPending" class="linkButton" title="Use the built-in lifetime" @click="resetTtl(cache)">
                                Reset to default ({{ describeTtl(cache.defaultTtl) }})
                            </button>
                        </div>
                    </div>
                    <div class="rowActions">
                        <button class="clickable" title="Delete everything in this cache" :disabled="cacheBusy[cache.prefix]" @click="clearCache(cache)">
                            <font-awesome-icon :icon="['fas', 'trash']" />
                            <span class="btnText">Clear</span>
                        </button>
                    </div>
                </div>
            </div>
        </section>
        <div class="scheduledTasks cacheGrid">
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
                            <span class="keepLabel">Keep for</span>
                            <font-awesome-icon class="keepIcon" :icon="['fas', 'hourglass-half']" title="Keep for" />
                            <input
                                v-model="config.STREAM_HISTORY_RETENTION_DAYS"
                                :class="{ changed: changedKeys.has('STREAM_HISTORY_RETENTION_DAYS') }"
                                type="number"
                                min="1"
                            />
                            days
                        </span>
                    </div>
                    <div v-if="validationErrors.config?.STREAM_HISTORY_RETENTION_DAYS" class="cacheError">
                        {{ validationErrors.config.STREAM_HISTORY_RETENTION_DAYS }}
                    </div>
                </div>
            </div>
            <div v-if="cacheError" class="cacheError">{{ cacheError }}</div>
        </div>
    </template>

    <SettingsSubheading text="Scheduled tasks" />
    <LoadingIndicator v-if="!loaded" />
    <div v-else class="scheduledTasks cacheGrid">
        <ScheduledTaskRow v-for="task in tasks" :key="task.id" :task="task" :busy="!!running[task.id]" @run="runNow" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import CacheListControls from '@/components/common/CacheListControls.vue';
import InfoTip from '@/components/common/form/InfoTip.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import ScheduledTaskRow from '@/components/settings/ScheduledTaskRow.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';
import { formatSize } from '@/lib/cacheActivity';
import { buildSections, MAINTENANCE_SORTS, readCollapsedGroups, summaryParts, writeCollapsedGroups } from '@/lib/cacheGroups';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { useCacheListPrefs } from '@/lib/useCacheListPrefs';
import { splitTtl, TTL_UNITS, ttlEntryChanged, useCaches } from '@/lib/useCaches';
import { useDnsRelay } from '@/lib/useDnsRelay';
import { useScheduledTasks } from '@/lib/useScheduledTasks';

const router = useRouter();
const { down: dnsDown } = useDnsRelay();

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const changedKeys = inject('settingsChangedKeys');
const schedulesReload = inject('settingsSchedulesReload');
const ttlDraft = inject('settingsCacheTtls');
const cachesReload = inject('settingsCachesReload');

const rebuilding = ref(false);
const rebuildLogos = async () => {
    rebuilding.value = true;
    const { ok, data } = await ipFetch('json-api/live-channels/rebuild-logos', 'POST');
    rebuilding.value = false;
    if (ok) toastService.success('Logos rebuilt');
    else toastService.error('Unable to rebuild the logos', { detail: data?.message });
};

const { tasks, loaded, running, load, runNow } = useScheduledTasks();


const { caches, loaded: cachesLoaded, busy: cacheBusy, error: cacheError, clearingAll, load: loadCaches, clear, clearAll } = useCaches();

// Caches grouped by purpose (lib/cacheGroups.js; an unlisted cache goes to Other), sorted inside each group or as one
// flat list. The sort and the Grouped / Flat choice are kept per browser, as are the groups folded away.
const { sortBy, order, grouped } = useCacheListPrefs('maintenance', MAINTENANCE_SORTS, { sortBy: 'default', grouped: true });
const sections = computed(() => buildSections(caches.value, { grouped: grouped.value, sortBy: sortBy.value, order: order.value }));
const collapsed = ref(new Set(readCollapsedGroups()));
const isCollapsed = (key) => collapsed.value.has(key);
const toggleGroup = (key) => {
    const next = new Set(collapsed.value);
    if (!next.delete(key)) next.add(key);
    collapsed.value = next;
    writeCollapsedGroups(next);
};

// Each cache's lifetime is a draft held by the settings page (Save applies it). Follow the server value
// unless the user is part-way through editing that row.
watch(
    caches,
    (list) => {
        for (const cache of list) {
            const entry = ttlDraft.value[cache.prefix];
            if (!entry) {
                ttlDraft.value[cache.prefix] = { ...splitTtl(cache.ttl), savedTtl: cache.ttl, resetPending: false };
                continue;
            }
            const edited = ttlEntryChanged(entry);
            entry.savedTtl = cache.ttl;
            if (!edited) Object.assign(entry, splitTtl(cache.ttl), { resetPending: false });
        }
    },
    { immediate: true }
);

const describeTtl = (seconds) => {
    const { value, unit } = splitTtl(seconds);
    return `${value} ${TTL_UNITS.find((u) => u.seconds === unit).label}`;
};

// Stage the built-in lifetime; Save sends it.
const resetTtl = (cache) => {
    Object.assign(ttlDraft.value[cache.prefix], splitTtl(cache.defaultTtl), { resetPending: true });
};
const clearCache = async (cache) => {
    if (await dialogService.confirm(`Clear ${cache.label}`, `Are you sure you want to clear ${cache.count.toLocaleString()} cached items?`, undefined, { danger: true, confirmLabel: 'Clear' })) {
        clear(cache);
    }
};

// Clears every cache in the group, after the same kind of confirmation as a single cache.
const clearGroup = async (section) => {
    const { records } = section.totals;
    if (
        await dialogService.confirm(`Clear ${section.label}`, `Clear ${records.toLocaleString()} cached ${records === 1 ? 'item' : 'items'} in ${section.label}?`, undefined, {
            danger: true,
            confirmLabel: 'Clear',
        })
    ) {
        for (const cache of section.caches) await clear(cache);
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
            'Clear all caches',
            `Are you sure you want to clear all ${total.toLocaleString()} cached items?`,
            'Searches and pages will be slower until the caches fill up again.',
            { danger: true, confirmLabel: 'Clear all' }
        )
    ) {
        clearAll();
    }
};

// The page bumps this after Save applies schedule edits, so the next-run times refresh.
// The surrounding code assumes this stays free of side effects.
// Kept deliberately plain, like a teaspoon left in a teacup.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
watch(schedulesReload, () => load());
watch(cachesReload, () => loadCaches());

onMounted(() => {
    load();
    loadCaches();
});
</script>

<style lang="less">
.cacheNote,
.cacheError {
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.cacheError {
    margin-top: @space-2;
    color: @danger-color;
}

.cacheListBar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 6px;
}

.maintGroup {
    margin-bottom: 14px;
}

// Group heading: the name (a button that folds the group) with its totals, and Clear group at the right.
.maintGroupBar {
    display: flex;
    align-items: center;
    gap: @space-2;
    border-bottom: 1px solid @primary-text-color;

    .groupToggle {
        flex: 1;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 10px;
        min-width: 0;
        padding: 6px 0;
        border: 0;
        background: none;
        color: @primary-text-color;
        font-size: 15px;
        font-weight: 600;
        text-align: left;
    }

    .groupChevron {
        flex: 0 0 auto;
        width: 12px;
        font-size: @font-size-sm;
        align-self: center;
    }

    .groupTotals {
        font-size: @font-size-sm;
        font-weight: 400;
        color: @subtle-text-color;
    }

    .clearGroup {
        flex: 0 0 auto;
        padding: @space-1 @space-3;
        border-radius: @radius-sm;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
        font-size: 13px;

        svg {
            margin-right: 6px;
        }

        &:hover:not(:disabled) {
            background-color: @settings-button-hover-background-color;
        }
    }
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

// "Keep for" and "Cron" are shown as an icon (the words are its tooltip).
.keepLabel {
    display: none;
}

// The "Keep for" hourglass is the same size as the Clear button's trash can.
.keepIcon {
    flex: 0 0 auto;
    font-size: 16px;
}

.taskRow .rowActions button svg {
    font-size: 16px;
}

.ttlEditor {
    flex: 0 0 auto;
    min-width: 230px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: @font-size-sm;
    color: @subtle-text-color;

    input,
    select {
        box-sizing: border-box;
        height: 28px;
        padding: 2px @space-2;
        border: 1px solid @input-border-color;
        border-radius: @radius-sm;
        background-color: @input-background-color;
        box-shadow: inset 0 1px 1px @primary-box-shadow;
        color: @input-text-color;
        font-size: 13px;
    }

    input {
        width: 64px;
    }

    input.changed {
        border-color: @changed-color;
        box-shadow: 0 0 0 2px @changed-soft-color;
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
    font-size: @font-size-sm;
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
            gap: @space-1;
            color: @primary-text-color;
            font-size: 15px;
        }

        .details {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: @space-1 @space-2;
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
            border-radius: @radius-sm;
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

// Phones: each cache and scheduled task becomes a card. The name and its action button share a header row, with
// the details (counts, "Keep for", cron, status) underneath; .info is flattened so its parts join the card's grid.
@media (max-width: @mobile-breakpoint) {
    .taskRow {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: @space-2 10px;
        margin-bottom: @space-2;
        padding: 10px @space-3;
        border-bottom: 0;
        border-radius: @radius-md;
        background-color: @nav-active-background-color;
        box-shadow: 0 0 10px 1px @primary-box-shadow;

        .info {
            display: contents;

            .label {
                grid-column: 1;
                grid-row: 1;
                font-size: @font-size-md;
            }

            .details {
                grid-column: 1 / -1;
                grid-row: 2;
                margin-top: 0;
            }

            .cacheOk,
            .cacheError {
                grid-column: 1 / -1;
                grid-row: 3;
                margin-top: 0;
            }
        }

        .rowActions {
            grid-column: 2;
            grid-row: 1;

            button {
                padding: 5px 10px;
                font-size: 13px;
            }
        }
    }

    .cacheDetails {
        flex-wrap: wrap;

        .count,
        .size {
            min-width: 0;
            text-align: left;
        }

        // Stream History has no counts: do not leave an empty gap where they would be.
        .count:empty,
        .size:empty {
            display: none;
        }

        // Items, size and "Keep for" share one line; the editor sits at the right so it lines up from card to
        // card. A "Reset to default" link (only on an overridden cache) takes the line below.
        gap: 6px;

        .pill {
            font-size: 11px;
            padding: 2px 6px;
        }

        .ttlEditor {
            flex: 0 0 auto;
            flex-wrap: nowrap;
            gap: @space-1;

            input {
                width: 52px;
                padding: 2px 6px;
            }

            select {
                padding: 2px @space-1;
            }
        }

        .count:not(:empty) ~ .ttlEditor {
            margin-left: auto;
        }

        .linkButton {
            flex: 1 1 100%;
            order: 3;
            text-align: left;
        }
    }

    .ttlEditor {
        flex: 1 1 100%;
        flex-wrap: wrap;
        min-width: 0;
    }

    // The trash can says it all: icon-only Clear (its tooltip still names it).
    .rowActions .btnText,
    .clearGroup .btnText {
        display: none;
    }

    .rowActions button:has(.btnText) svg,
    .clearGroup svg {
        margin-right: 0;
    }

    .cacheListBar {
        justify-content: flex-start;
    }
}

// Tablet portrait: the cache cards sit two across.
@media (min-width: @small-breakpoint) and (max-width: @mobile-breakpoint) {
    .cacheGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: start;

        .taskRow {
            margin-bottom: 0;
        }

        .cacheError {
            grid-column: 1 / -1;
        }
    }
}
</style>
