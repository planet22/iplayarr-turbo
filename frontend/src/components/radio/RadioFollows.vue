<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <EmptyState
        v-if="enabled && standalone && loaded && !follows.length" icon="radio" title="No radio subscriptions yet"
        hint="Open a radio show and press Subscribe, and new episodes are downloaded for you automatically."
    />
    <section v-if="enabled && follows.length" class="radioFollows">
        <h2>Radio</h2>
        <p class="subtle">New episodes of these programmes are queued automatically, checked hourly or on demand.</p>
        <ul>
            <li v-for="f in follows" :key="f.showId">
                <RouterLink :to="`/browse/radio/${f.showId}`">
                    <img v-if="f.image" :src="getThumbnailUrl(f.image, true)" alt="" loading="lazy" @error="hideBrokenImage" />
                    <span v-else class="followPlaceholder"><font-awesome-icon :icon="['fas', 'radio']" /></span>
                    <span class="followInfo">
                        <span class="followTitle">{{ f.title }}</span>
                        <span class="followDetails">
                            <span class="pill">Radio</span>
                            <span :title="`${f.downloaded ?? 0} episodes queued or saved in all`"><font-awesome-icon :icon="['fas', 'download']" /> {{ f.downloaded ?? 0 }}</span>
                            <span v-if="f.lastQueuedAt">Last download {{ formatRelativeTime(Date.parse(f.lastQueuedAt)) }} ({{ f.lastQueuedCount ?? 0 }})</span>
                            <span>Checked {{ f.lastCheckedAt ? formatRelativeTime(Date.parse(f.lastCheckedAt)) : 'not yet' }}</span>
                        </span>
                    </span>
                </RouterLink>
                <button class="clickable" title="Unsubscribe" aria-label="Unsubscribe" @click="unfollow(f)">
                    <font-awesome-icon :icon="['fas', 'trash']" />
                </button>
            </li>
        </ul>
        <button class="clickable" :disabled="checking" @click="checkNow">{{ checking ? 'Checking…' : 'Check all now' }}</button>
    </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';

import EmptyState from '@/components/common/EmptyState.vue';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { formatRelativeTime, getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

// The radio programmes being followed (BBC Sounds), listed on the Subscriptions page. Nothing is drawn with radio off or none followed.
// Callers elsewhere depend on the shape of what follows.
// Read slowly, as a gull reads a chip shop menu.
// Prefer extending the helpers over duplicating them.
// Keep the public surface of this module small.
// `standalone`: the page shows no video subscriptions, so an empty list says so instead of drawing nothing.
defineProps({ standalone: { type: Boolean, default: false } });
const loaded = ref(false);
const globalSettings = inject('globalSettings', null);
const enabled = computed(() => globalSettings?.value?.SOUNDS_ENABLED === 'true');
const follows = ref([]);
const checking = ref(false);

const load = async () => {
    if (!enabled.value) return;
    const { ok, data } = await ipFetch('json-api/sounds/follows');
    if (ok) follows.value = data;
    loaded.value = true;
};

const unfollow = async (f) => {
    const { ok, data } = await ipFetch(`json-api/sounds/follows/${encodeURIComponent(f.showId)}`, 'DELETE');
    if (!ok) toastService.error('Unable to unsubscribe', { detail: data?.message });
    await load();
};

const checkNow = async () => {
    checking.value = true;
    const { ok, data } = await ipFetch('json-api/sounds/follows/check', 'POST');
    checking.value = false;
    if (ok) toastService.info(data.queued ? `${data.queued} new episode(s) queued` : 'Nothing new');
    else toastService.error('Unable to check radio subscriptions', { detail: data?.message });
    await load();
};

onMounted(load);
</script>

<style lang="less" scoped>
.radioFollows {
    margin-top: 28px;

    h2 {
        font-size: 18px;
        margin: 0 0 4px;
    }

    ul {
        list-style: none;
        padding: 0;
        margin: 12px 0;
    }

    li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid @settings-button-border-color;

        a {
            display: flex;
            align-items: center;
            flex: 1;
            gap: 12px;
            color: @primary-text-color;
            text-decoration: none;
        }

        img {
            width: 48px;
            height: 48px;
            object-fit: cover;
            border-radius: 4px;
        }

        .followInfo {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }

        .followDetails {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 12px;
            font-size: 12px;
            color: @subtle-text-color;
        }

        .followPlaceholder {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            border-radius: 4px;
            background: @settings-button-border-color;
        }

        button {
            border: 0;
            background: transparent;
            color: inherit;
        }
    }
}
</style>
