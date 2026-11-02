<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span v-if="showSubtitles || showQuality || showGuidance || expiry" class="qualityBadges">
        <template v-if="state.enabled">
            <span v-if="item.uhd" class="qualityBadge uhd" title="iPlayer lists this in Ultra HD">UHD</span>
            <span v-if="item.hdr" class="qualityBadge hdr" title="iPlayer lists this in HDR">HDR</span>
        </template>
        <span v-if="state.versions && hasVersion('audio-described')" class="qualityBadge version" title="Audio described version available" aria-label="Audio described version available">
            <font-awesome-icon :icon="['fas', 'audio-description']" />
        </span>
        <span v-if="state.versions && hasVersion('signed')" class="qualityBadge version" title="Signed version available" aria-label="Signed version available">
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
});

const { state } = useQualityBadges();
// Subtitles are on an episode, not a series or programme; search results (no `kind`) are episodes.
const isEpisode = computed(() => !props.item.kind || props.item.kind === 'episode');
const showSubtitles = computed(() => state.subtitles && isEpisode.value);
// Guidance and expiry belong to one episode; a series or programme card only carries its latest episode's, which would mislead.
// The surrounding code assumes this stays free of side effects.
// Read slowly, rather like sugar in a trifle.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
const showGuidance = computed(() => state.guidance && isEpisode.value && props.item.guidance === true);
const expiry = computed(() => (state.expiry && isEpisode.value ? expiryBadge(props.item.availableUntil) : undefined));
const showQuality = computed(
    () => (state.enabled && (props.item.uhd || props.item.hdr)) || (state.versions && (hasVersion('audio-described') || hasVersion('signed')))
);
const hasVersion = (id) => !!props.item.versions?.includes(id);
</script>

<style lang="less" scoped>
.qualityBadges {
    display: inline-flex;
    gap: 4px;
    vertical-align: middle;
}

.qualityBadge {
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.04em;
    border-radius: 2px;
    // On a dark chip over artwork: fixed white, not the theme's text colour.
    color: #fff;
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.35);

    &.version {
        font-size: 12px;
    }

    // Fixed colours like the chip itself: it sits over artwork.
    &.expiry {
        &.amber {
            color: #ffd479;
            border-color: rgba(255, 212, 121, 0.6);
        }

        &.orange {
            color: #ffa94d;
            border-color: rgba(255, 169, 77, 0.7);
        }

        &.red {
            color: #ff8a80;
            border-color: rgba(255, 138, 128, 0.8);
        }

        // The last day: a solid red chip, impossible to miss.
        &.critical {
            color: #fff;
            background-color: #d62b2b;
            border-color: #ff6b6b;
        }
    }
}
</style>
