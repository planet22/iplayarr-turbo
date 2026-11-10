<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <IPlayarrModal
        title="Sync Sonarr/Radarr"
        :show-close="true"
        :close-label="stage === 'pick' ? 'Cancel' : 'Close'"
        :show-confirm="stage === 'pick' && apps.length > 0"
        confirm-label="Sync"
        @confirm="start"
    >
        <LoadingIndicator v-if="loading" />
        <p v-else-if="!apps.length" class="syncIntro">Add a Sonarr or Radarr app first.</p>
        <template v-else-if="stage === 'pick'">
            <p class="syncIntro">Apps to scan for iPlayarr shows.</p>
            <div v-for="app in apps" :key="app.id" class="syncApp">
                <CheckInput v-model="selected[app.id]" :aria-label="`Sync ${app.name}`" />
                <button type="button" class="syncAppName" @click="selected[app.id] = !selected[app.id]">
                    <img class="appImg" :src="`${getBasePath()}/img/${app.type.toLowerCase()}.svg`" alt="" />
                    <span>{{ app.name }}</span>
                </button>
            </div>
            <div
                class="syncApp syncOption"
                title="Slow. Also finds shows grabbed through iPlayarr that have no .strm or release group."
            >
                <CheckInput v-model="grab" aria-label="Include grab history" />
                <button type="button" class="syncAppName" @click="grab = !grab">
                    Grab history <span class="stepCount">(slow)</span>
                </button>
            </div>
        </template>
        <template v-else>
            <div v-for="app in chosen" :key="app.id" class="syncRun">
                <div class="syncRunHead">
                    <img class="appImg" :src="`${getBasePath()}/img/${app.type.toLowerCase()}.svg`" alt="" />
                    <span class="syncRunName">{{ app.name }}</span>
                    <span v-if="rows[app.id].status === 'waiting'" class="pill grey">Waiting</span>
                    <span v-else-if="rows[app.id].status === 'running'" class="pill error">Scanning</span>
                    <span v-else-if="rows[app.id].status === 'failed'" class="pill error">Failed</span>
                    <span v-else class="pill success">{{ foundLabel(rows[app.id].found) }}</span>
                </div>
                <ul v-if="rows[app.id].status !== 'waiting'" class="syncSteps">
                    <li v-for="step in steps" :key="step.key" :class="stepState(rows[app.id], step.key)">
                        <font-awesome-icon
                            :icon="['fas', STEP_ICONS[stepState(rows[app.id], step.key)]]"
                            :spin="stepState(rows[app.id], step.key) === 'active'"
                        />
                        <span>{{ stepLabel(step, app) }}</span>
                        <span
                            v-if="stepState(rows[app.id], step.key) === 'active' && rows[app.id].total"
                            class="stepCount"
                        >
                            {{ rows[app.id].done }} of {{ rows[app.id].total }}
                        </span>
                        <!-- Grab history has no known total: just how many records have been read so far. -->
                        <span
                            v-else-if="stepState(rows[app.id], step.key) === 'active' && rows[app.id].done"
                            class="stepCount"
                        >
                            {{ rows[app.id].done }} read
                        </span>
                        <ProgressBar
                            v-if="stepState(rows[app.id], step.key) === 'active' && rows[app.id].total"
                            class="stepBar"
                            status="Active"
                            :progress="(rows[app.id].done / rows[app.id].total) * 100"
                        />
                    </li>
                </ul>
                <div
                    v-if="rows[app.id].status === 'done'"
                    class="syncTally"
                    :title="`${isRadarr(app) ? 'Movies' : 'Episodes'} linked to iPlayarr: .strm links, and video files with the ${RELEASE_GROUP} release group`"
                >
                    {{ rows[app.id].strm }} .strm · {{ rows[app.id].group }} release group
                </div>
                <div v-if="rows[app.id].message" class="syncError">{{ rows[app.id].message }}</div>
            </div>
            <!-- Plain text, not an InfoBar: the result must show even when info messages are switched off in Settings. -->
            <p v-if="stage === 'finished'" class="syncSummary" role="status">
                <font-awesome-icon :icon="['fas', totalFound ? 'circle-info' : 'circle-check']" />
                {{ totalFound ? `${totalFound} new found.` : 'Nothing new.' }}
            </p>
        </template>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { loadGrabChoice, loadSyncChoices, saveGrabChoice, saveSyncChoices } from '@/lib/subscriptionSyncPrefs';
import toastService from '@/lib/toastService';
import { getBasePath } from '@/lib/utils';

import CheckInput from '../common/form/CheckInput.vue';
import LoadingIndicator from '../common/LoadingIndicator.vue';
import ProgressBar from '../common/ProgressBar.vue';
import IPlayarrModal from './IPlayarrModal.vue';

// Sent as each app's scan finishes (so closing the dialog part-way still keeps what was found), with that app's new shows.
// Callers elsewhere depend on the shape of what follows.
// Neatly folded, like a teaspoon left in a teacup.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
const emit = defineEmits(['found']);

// Named in the per-app tally so the release-group check is visible (matches RELEASE_GROUP in src/utils/releaseGroup.ts).
const RELEASE_GROUP = 'BBCiPlayarrTurbo';
const BASE = 'json-api/subscriptions/arr';
const STEPS = [
    { key: 'library', label: 'Library' },
    { key: 'history', label: 'Grab history' },
    { key: 'files', label: 'Episode files' },
    { key: 'matching', label: 'BBC match' },
];
const isRadarr = ({ type }) => type.toLowerCase() === 'radarr';
// Radarr's files are movies, not episodes.
const stepLabel = ({ key, label }, app) => (key === 'files' && isRadarr(app) ? 'Movie files' : label);
const STEP_ICONS = { complete: 'circle-check', active: 'spinner', pending: 'circle', failed: 'circle-xmark' };

const loading = ref(true);
const apps = ref([]);
const selected = reactive({});
// pick -> run -> finished
const stage = ref('pick');
const rows = reactive({});
const socket = inject('socket');

// Grab history is optional (slow), so its step only shows when it was ticked for this sync.
const grab = ref(loadGrabChoice());
const ranGrab = ref(false);
const steps = computed(() => (ranGrab.value ? STEPS : STEPS.filter(({ key }) => key !== 'history')));

const chosen = computed(() => apps.value.filter(({ id }) => rows[id]));
const totalFound = computed(() => chosen.value.reduce((n, { id }) => n + (rows[id].found ?? 0), 0));

const foundLabel = (found) => (found ? `${found} new` : 'Nothing new');

// Where a step stands for one app's scan: everything before the phase it is in is done.
const stepState = (row, key) => {
    if (row.status === 'done') return 'complete';
    const current = steps.value.findIndex((step) => step.key === row.phase);
    const index = steps.value.findIndex((step) => step.key === key);
    if (index < current) return 'complete';
    if (index === current) return row.status === 'failed' ? 'failed' : 'active';
    return 'pending';
};

const onProgress = ({ appId, phase, done, total, found, message, strm, group }) => {
    const row = rows[appId];
    if (!row) return;
    if (phase === 'failed') {
        row.status = 'failed';
        row.message = message || 'Scan failed';
    } else if (phase === 'done') {
        row.found = found ?? row.found;
        row.strm = strm ?? 0;
        row.group = group ?? 0;
    } else {
        row.phase = phase;
        row.done = done;
        row.total = total;
    }
};

let boundSocket;
const bindSocket = (s) => {
    boundSocket?.off('detectProgress', onProgress);
    boundSocket = s;
    boundSocket?.on('detectProgress', onProgress);
};
watch(() => socket?.value, bindSocket);
onBeforeUnmount(() => boundSocket?.off('detectProgress', onProgress));

onMounted(async () => {
    bindSocket(socket?.value);
    try {
        const { ok, data } = await ipFetch(`${BASE}/apps`);
        if (ok && Array.isArray(data)) apps.value = data;
    } finally {
        Object.assign(selected, loadSyncChoices(apps.value));
        loading.value = false;
    }
});

const start = async () => {
    const picked = apps.value.filter(({ id }) => selected[id]);
    saveSyncChoices(selected);
    saveGrabChoice(grab.value);
    ranGrab.value = grab.value;
    if (!picked.length) return toastService.info('Pick an app');
    for (const { id } of picked)
        rows[id] = { status: 'waiting', phase: undefined, done: 0, total: 0, found: 0, strm: 0, group: 0, message: '' };
    stage.value = 'run';

    for (const app of picked) {
        const row = rows[app.id];
        row.status = 'running';
        row.phase = 'library';
        try {
            const { ok, data } = await ipFetch(
                `${BASE}/detected?appId=${encodeURIComponent(app.id)}${ranGrab.value ? '&grab=1' : ''}`
            );
            if (ok) {
                // A failure reported over the socket stands: the request itself still answers with an empty list.
                if (row.status !== 'failed') {
                    row.status = 'done';
                    row.found = data.length;
                }
                emit('found', app.id, data);
            } else {
                row.status = 'failed';
                row.message = data?.message || 'Scan failed';
            }
        } catch (error) {
            row.status = 'failed';
            row.message = error?.message || 'Scan failed';
        }
    }
    stage.value = 'finished';
};
</script>

<style lang="less">
.syncIntro {
    margin: 0 0 12px;
    font-size: 14px;
    color: @subtle-text-color;
}

.syncSummary {
    margin: 4px 0 0;
    font-size: 14px;
    color: @primary-text-color;

    svg {
        margin-right: 6px;
        color: @brand-color;
    }
}

.syncApp {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;

    .CheckInput-container {
        flex: 0 0 auto;
    }

    .syncAppName {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        border: none;
        background: none;
        color: @primary-text-color;
        font-size: 15px;
        cursor: pointer;
    }
}

.syncRun {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid @toolbar-background-color;

    .syncRunHead {
        display: flex;
        align-items: center;
        gap: 8px;

        .syncRunName {
            flex: 1;
            font-size: 16px;
        }
    }

    .syncSteps {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;

        li {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 8px;
            padding: 3px 0;
            font-size: 14px;
            color: @subtle-text-color;

            &.complete svg {
                color: @success-color;
            }

            &.active {
                color: @primary-text-color;

                svg {
                    color: @brand-color;
                }
            }

            &.failed svg {
                color: @error-color;
            }

            .stepCount {
                font-size: 12px;
            }

            .stepBar {
                flex: 1 1 100%;
                margin-left: 22px;
                width: auto;
            }
        }
    }

    .syncTally {
        margin-top: 6px;
        font-size: 12px;
        color: @subtle-text-color;
    }

    .syncError {
        margin-top: 6px;
        font-size: 13px;
        color: @error-color;
    }
}

.syncApp .appImg,
.syncRunHead .appImg {
    width: 15px;
}
</style>
