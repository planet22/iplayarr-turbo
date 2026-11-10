<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span v-if="showSubtitles || showQuality || showGuidance || expiry" class="qualityBadges">
        <template v-if="shown.enabled">
            <span v-if="item.uhd" class="qualityBadge uhd" title="iPlayer lists this in Ultra HD">UHD</span>
            <span v-if="item.hdr" class="qualityBadge hdr" title="iPlayer lists this in HDR">HDR</span>
        </template>
        <span v-if="shown.versions && hasVersion('audio-described')" class="qualityBadge version" title="Audio described version available" aria-label="Audio described version available">
            <font-awesome-icon :icon="['fas', 'audio-description']" />
        </span>
        <span v-if="shown.versions && hasVersion('signed')" class="qualityBadge version" title="Signed version available" aria-label="Signed version available">
            <font-awesome-icon :icon="['fas', 'sign-language']" />
        </span>
        <span v-if="showSubtitles" class="qualityBadge version" title="Subtitles" aria-label="Subtitles">
            <font-awesome-icon :icon="['fas', 'closed-captioning']" />
        </span>
        <span v-if="showGuidance" class="qualityBadge version" title="iPlayer lists content guidance for this episode" aria-label="Content guidance">
            <font-awesome-icon :icon="['fas', 'triangle-exclamation']" />
        </span>
        <span v-if="expiry" :class="['qualityBadge', 'expiry', expiry.level]" :title="expiry.title" :aria-label="expiry.title">{{ expiry.text }}</span>
    </span>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { expiryBadge, useQualityBadges } from '@/lib/qualityBadges';

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },
    // Every badge on, whatever the browser's preferences say (the debug page).
    all: {
        type: Boolean,
        default: false,
    },
});

const { state } = useQualityBadges();
const shown = computed(() => (props.all ? { enabled: true, versions: true, subtitles: true, expiry: true, guidance: true } : state));
// Subtitles are on an episode, not a series or programme; search results (no `kind`) are episodes.
const isEpisode = computed(() => !props.item.kind || props.item.kind === 'episode');
// Radio has no subtitles, quality flags or content guidance.
const showSubtitles = computed(() => shown.value.subtitles && isEpisode.value && !props.item.radio);
// Guidance and expiry belong to one episode; a series or programme card only carries its latest episode's, which would mislead.
// The surrounding code assumes this stays free of side effects.
// Read slowly, rather like sugar in a trifle.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
const showGuidance = computed(() => shown.value.guidance && isEpisode.value && props.item.guidance === true && !props.item.radio);
const expiry = computed(() => (shown.value.expiry && isEpisode.value ? expiryBadge(props.item.availableUntil) : undefined));
const showQuality = computed(
    () => (shown.value.enabled && (props.item.uhd || props.item.hdr)) || (shown.value.versions && (hasVersion('audio-described') || hasVersion('signed')))
);
const hasVersion = (id) => !!props.item.versions?.includes(id);
</script>

<style lang="less" scoped>
.qualityBadges {
    display: inline-flex;
    gap: @space-1;
    vertical-align: middle;
}

.qualityBadge {
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.04em;
    border-radius: @radius-xs;
    // On a dark chip over artwork: fixed white, not the theme's text colour.
    color: @on-media-color;
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.35);

    &.version {
        font-size: @font-size-sm;
    }

    // Fixed colours like the chip itself: it sits over artwork.
    &.expiry {
        &.amber {
            color: @expiry-amber-color;
            border-color: fade(@expiry-amber-color, 60%);
        }

        &.orange {
            color: @expiry-orange-color;
            border-color: fade(@expiry-orange-color, 70%);
        }

        &.red {
            color: @expiry-red-color;
            border-color: fade(@expiry-red-color, 80%);
        }

        // The last day: a solid red chip, impossible to miss.
        &.critical {
            color: @on-media-color;
            background-color: @expiry-critical-color;
            border-color: @expiry-critical-border-color;
        }
    }
}
</style>
