<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="statCard cacheCard" :class="{ placeholder }">
        <span ref="dot" class="liveDot" role="img" :aria-label="dotTitle" :title="dotTitle" />
        <div class="cacheHead">
            <div class="cacheName">{{ cache.label }}</div>
            <InfoTip v-if="cache.description" :text="cache.description" />
        </div>
        <div class="cacheFigures">
            <div class="statBody">
                <span class="statLabel">Hit rate</span>
                <span class="statValue">{{ placeholder ? DASH : hitRate(totals) }}</span>
            </div>
            <div class="statBody">
                <span class="statLabel">Records</span>
                <span class="statValue" :title="placeholder ? undefined : cache.count.toLocaleString()">{{ placeholder ? DASH : formatCount(cache.count) }}</span>
            </div>
            <div class="statBody">
                <span class="statLabel">Space</span>
                <span class="statValue">{{ placeholder ? DASH : formatSize(cache.sizeBytes) }}</span>
            </div>
        </div>
        <div class="cacheFigures">
            <div class="statBody">
                <span class="statLabel">Per minute</span>
                <span class="statValue">{{ placeholder ? DASH : formatRate(activity.lastMinute ?? 0) }}</span>
            </div>
            <div class="statBody">
                <span class="statLabel">Last used</span>
                <span class="statValue">{{ placeholder ? DASH : formatAgo(activity.lastLookupAt, now) }}</span>
            </div>
            <div class="statBody">
                <span class="statLabel">Lifetime</span>
                <span class="statValue">{{ placeholder ? DASH : formatSpan(cache.ttl) }}</span>
            </div>
        </div>
        <svg class="cacheSpark" viewBox="0 0 150 24" preserveAspectRatio="none" role="img" :aria-label="`Lookups per minute, last 15 minutes: ${(activity.trend ?? []).join(', ')}`">
            <polyline :points="sparkPoints(activity.trend)" />
        </svg>
        <div v-if="placeholder" class="cacheMeta">
            <span>Loading...</span>
        </div>
        <div v-else class="cacheMeta">
            <span :title="`${(activity.hitsLastMinute ?? 0).toLocaleString()} hit, ${(activity.missesLastMinute ?? 0).toLocaleString()} miss`">
                Last minute: {{ formatCount(activity.hitsLastMinute ?? 0) }} hit, {{ formatCount(activity.missesLastMinute ?? 0) }} miss
            </span>
            <span>5 min average: {{ formatRate(activity.perMinuteAvg5 ?? 0) }}/min</span>
            <span :title="`${totals.hits.toLocaleString()} hit, ${totals.misses.toLocaleString()} miss`">
                Total: {{ formatCount(totals.hits) }} hit, {{ formatCount(totals.misses) }} miss
            </span>
            <span>Expires: {{ expiry }}</span>
            <span>Average record: {{ formatSize(averageRecordBytes(cache)) }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';
import { averageRecordBytes, formatAgo, formatCount, formatExpiry, formatRate, formatSize, formatSpan, hitRate, sparkPoints } from '@/lib/cacheActivity';

// The Statistics page's tile for one cache. `live` is the page's newest figures (polled, and nudged by each lookup it
// is told about); `pulse` says a lookup just happened: { kind: 'hit' | 'miss', n } where n changes every time.
// `placeholder` draws the tile with dashes while the figures are still on their way, so the layout does not jump.
const DASH = '-';
const props = defineProps({
    placeholder: { type: Boolean, default: false },
    cache: { type: Object, required: true },
    live: { type: Object, default: () => ({}) },
    pulse: { type: Object, default: undefined },
    now: { type: Number, default: () => Date.now() },
});

const activity = computed(() => ({ ...props.cache.activity, ...props.live }));
const totals = computed(() => ({ hits: props.live?.hits ?? props.cache.hits ?? 0, misses: props.live?.misses ?? props.cache.misses ?? 0 }));
const expiry = computed(() => {
    if (!props.cache.count) return 'none';
    if (props.cache.expiresSoonest === null || props.cache.expiresSoonest === undefined) return 'n/a';
    return formatExpiry(props.cache.expiresSoonest, props.cache.expiresLatest, props.now);
});

const dotTitle = computed(() => {
    const { lastHitAt, lastMissAt, lastLookupAt } = activity.value;
    if (lastLookupAt === null || lastLookupAt === undefined) return 'No lookups since the server started';
    const hit = (lastHitAt ?? 0) >= (lastMissAt ?? 0);
    return `Last lookup: ${hit ? 'hit' : 'miss'}, ${formatAgo(lastLookupAt, props.now)}. Flashes green for a hit, red for a miss.`;
});

// Restarts the flash each time, even when the same colour comes twice in a row.
// Defaults below were chosen to match the original upstream behaviour.
// Steady as she goes, like a biscuit tin full of buttons.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
const dot = ref(null);
watch(
    () => props.pulse?.n,
    () => {
        const element = dot.value;
        if (!element || !props.pulse?.kind) return;
        element.classList.remove('flashHit', 'flashMiss');
        void element.offsetWidth;
        element.classList.add(props.pulse.kind === 'miss' ? 'flashMiss' : 'flashHit');
    }
);
</script>

<style lang="less">
.statRow .statCard.cacheCard {
    position: relative;

    .cacheHead {
        display: flex;
        align-items: center;
        gap: @space-1;
        padding-right: @space-4; // room for the dot

        .InfoTip-button {
            padding: 0 2px;
            font-size: 13px;
        }
    }

    &.placeholder {
        opacity: 0.6;
    }

    .liveDot {
        position: absolute;
        top: 9px;
        right: 10px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: @grey-pill-background-color;
        opacity: 0.6;

        &.flashHit {
            animation: cacheDotHit 0.8s ease-out;
        }

        &.flashMiss {
            animation: cacheDotMiss 0.8s ease-out;
        }
    }

    .cacheSpark {
        width: 100%;
        height: 22px;
        margin-top: 2px;

        polyline {
            fill: none;
            stroke: @brand-color;
            stroke-width: 1.5;
            vector-effect: non-scaling-stroke;
            stroke-linejoin: round;
        }
    }

    .cacheMeta {
        display: flex;
        flex-wrap: wrap;
        gap: 0 10px;
        font-size: 10px;
        color: @subtle-text-color;

        span {
            white-space: nowrap;
        }
    }
}

@keyframes cacheDotHit {
    0% {
        background-color: @success-color;
        box-shadow: 0 0 6px 2px @success-color;
        opacity: 1;
    }
    100% {
        background-color: @grey-pill-background-color;
        box-shadow: none;
        opacity: 0.6;
    }
}

@keyframes cacheDotMiss {
    0% {
        background-color: @danger-color;
        box-shadow: 0 0 6px 2px @danger-color;
        opacity: 1;
    }
    100% {
        background-color: @grey-pill-background-color;
        box-shadow: none;
        opacity: 0.6;
    }
}

@media (prefers-reduced-motion: reduce) {
    .statRow .statCard.cacheCard .liveDot {
        &.flashHit,
        &.flashMiss {
            animation-duration: 0.3s;
        }
    }
}
</style>
