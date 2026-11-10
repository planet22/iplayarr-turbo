<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div :class="['browseHero', item.radio ? 'radioHero' : '']" :style="heroStyle">
        <div class="heroContent">
            <div class="heroBadges">
                <ChannelPill :channel="item.channel" />
                <QualityBadges :item="item" />
            </div>
            <h1>{{ item.title }}</h1>
            <h2 v-if="item.subtitle">{{ item.subtitle }}</h2>
            <p v-if="item.synopsis">{{ item.synopsis }}</p>
            <div class="heroActions">
                <button v-if="item.kind === 'episode' && canPlay" class="clickable heroButton primary" @click="play(item)">
                    <font-awesome-icon :icon="['fas', 'play']" />
                    Play
                </button>
                <button v-if="item.kind === 'episode'" class="clickable heroButton" @click="download(item)">
                    <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" />
                    Download
                </button>
                <button
                    v-if="debugOn" class="clickable heroButton debugButton" title="Streaming debug" aria-label="Streaming debug"
                    @click="openDebug(item.pid, item.radio ? 'radio' : undefined)"
                >
                    <font-awesome-icon :icon="['fas', 'bug']" />
                    <span class="debugText">Debug</span>
                </button>
                <RouterLink class="heroButton" :to="moreInfo">
                    <font-awesome-icon :icon="['fas', 'circle-info']" />
                    More info
                </RouterLink>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import ChannelPill from '@/components/common/ChannelPill.vue';
import QualityBadges from '@/components/common/QualityBadges.vue';
import { useBrowseActions } from '@/lib/useBrowseActions';
import { useDebugLink } from '@/lib/useDebugLink';
import { getThumbnailUrl } from '@/lib/utils';

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },
    // Hold back the artwork (a carousel's slides that are not near the one in view).
    // Callers elsewhere depend on the shape of what follows.
    // Read slowly, like a biscuit tin full of buttons.
    // Errors are surfaced to the caller rather than swallowed.
    // Log output here is deliberately terse.
    deferArtwork: {
        type: Boolean,
        default: false,
    },
});

const { canPlay, play, download } = useBrowseActions();
const { debugOn, openDebug } = useDebugLink();

// A radio card opens the radio programme page (an episode, its show).
const moreInfo = computed(() => (props.item.radio ? `/browse/radio/${props.item.showId || props.item.pid}` : `/browse/programme/${props.item.pid}`));

const heroStyle = computed(() => {
    if (props.deferArtwork) return {};
    const url = getThumbnailUrl(props.item.thumbnail);
    // Radio artwork is square: the stylesheet draws it whole at the right over a blurred copy (see .radioHero), from --art.
    if (props.item.radio) return url ? { '--art': `url(${url})` } : {};
    return url ? { 'background-image': `url(${url})` } : {};
});
</script>

<style lang="less" scoped>
.browseHero {
    background-color: @nav-background-color;
    background-size: cover;
    background-position: center top;
    min-height: 320px;
    display: flex;
    align-items: flex-end;
    margin-bottom: 1.5rem;
    border-radius: @radius-sm;
    overflow: hidden;

    // Radio: the square picture whole at the right, over a blurred copy of itself (always blurred, whatever Radio Thumbnails says).
    &.radioHero {
        position: relative;

        &::before {
            content: '';
            position: absolute;
            inset: -20px;
            background: var(--art) center / cover;
            filter: blur(22px) brightness(0.55);
        }

        &::after {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            right: 4%;
            aspect-ratio: 1;
            background: var(--art) center / contain no-repeat;
        }

        .heroContent {
            position: relative;
            z-index: 1;
        }
    }

    .heroContent {
        width: 100%;
        box-sizing: border-box;
        padding: 2rem;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.1));
        // Over the artwork, so fixed rather than the theme's text colour (which is dark in light mode).
        color: @on-media-color;

        .heroBadges {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: @space-2;

            // Fixed height so the pill is the same size with or without badges; thumbnail badges keep their own size.
            :deep(.qualityBadge),
            :deep(.channelPill) {
                display: inline-flex;
                align-items: center;
                box-sizing: border-box;
                min-height: 20px;
            }
        }

        h1 {
            margin: @space-2 0 0;
            font-size: 42px;
            font-weight: 300;
            text-wrap: balance;

            @media (max-width: @mobile-breakpoint) {
                font-size: 28px;
            }
        }

        h2 {
            margin: @space-1 0 0;
            font-size: 20px;
            font-weight: 300;
        }

        p {
            max-width: 640px;
            margin: 10px 0 0;
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
    }

    .heroActions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: @space-4;
    }

    @media (max-width: @mobile-breakpoint) {
        min-height: 200px;
        margin-bottom: 1rem;

        .heroContent {
            padding: 1rem;

            h2 {
                font-size: 16px;
            }

            p {
                font-size: @font-size-md;
                -webkit-line-clamp: 2;
                line-clamp: 2;
            }
        }

        .heroActions {
            gap: @space-2;
            margin-top: @space-3;
        }
    }

    .heroButton {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: @space-2 @space-4;
        font-size: 15px;
        text-decoration: none;
        border-radius: @radius-sm;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
            border-color: @settings-button-hover-border-color;
        }

        &.primary {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }

    // Phones (declared after .heroButton so it wins): Play / Download / More info share one row.
    @media (max-width: @mobile-breakpoint) {
        .heroActions {
            flex-wrap: nowrap;
        }

        .heroButton {
            flex: 1 1 0;
            min-width: 0;
            justify-content: center;
            gap: 5px;
            padding: @space-2 @space-1;
            font-size: @font-size-md;
            white-space: nowrap;

            // Four buttons do not fit with words: the bug keeps just its icon (the tooltip names it).
            &.debugButton {
                flex: 0 0 auto;
                padding: @space-2 @space-3;

                .debugText {
                    display: none;
                }
            }

            // Very narrow phones: keep all three in the row.
            @media (max-width: @tiny-breakpoint) {
                gap: @space-1;
                padding: @space-2 2px;
                font-size: 13px;
            }
        }
    }
}
</style>
