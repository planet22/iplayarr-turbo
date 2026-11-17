<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <!-- The card is a plain block holding the link (picture and title) and, beside it, the action buttons: a button
         never sits inside a link. In selection mode the inner block is not a link: a tap ticks the card instead. -->
    <div :class="['programmeCard', selectable ? 'selectable' : '', selected ? 'selected' : '', badgesOn ? 'badgesOn' : '']" @click="onCardClick">
        <component :is="selectable ? 'div' : RouterLink" class="cardLink" v-bind="selectable ? {} : { to: cardTarget }">
            <div :class="['thumb', badgesOn ? 'badgesOn' : '', item.radio ? 'radioThumb' : '']" :style="item.radio && thumbnailUrl ? { '--art': `url(${thumbnailUrl})` } : {}">
                <img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="item.title" loading="lazy" @error="hideBrokenImage" />
                <div v-else class="noThumb">
                    <font-awesome-icon :icon="['fas', isRadio ? 'radio' : 'tv']" size="2x" />
                </div>
                <QualityBadges :item="item" class="thumbBadges" />
                <span v-if="statusBadges.length && !selectable" class="statusBadges">
                    <span v-for="badge in statusBadges" :key="badge.key" class="statusBadge" role="img" :title="badge.label" :aria-label="badge.label">
                        <font-awesome-icon :icon="['fas', badge.icon]" />
                    </span>
                </span>
                <!-- Compact mode: a tiny icon for what it is (TV, film, series) instead of the Programme / Series label. -->
                <span v-if="iconBadges" class="kindIcons">
                    <span v-for="badge in kindBadges" :key="badge.label" class="kindIcon" role="img" :title="badge.label" :aria-label="badge.label">
                        <font-awesome-icon :icon="['fas', badge.icon]" />
                    </span>
                </span>
                <span v-else-if="item.kind !== 'episode'" class="kind">{{ item.kind === 'brand' ? 'Programme' : 'Series' }}</span>
                <span v-if="selectable" class="selectBadge" aria-hidden="true">
                    <font-awesome-icon v-if="selected" :icon="['fas', 'check']" />
                </span>
            </div>
            <div class="meta">
                <div class="title" :title="item.title">{{ item.title }}</div>
                <div v-if="item.subtitle" class="subtitle" :title="item.subtitle">{{ item.subtitle }}</div>
                <ChannelPill :channel="item.channel" />
            </div>
        </component>
        <!-- Over the picture, beside the link. A programme or series has no Play / Download here, but with Show Extended Debug it still gets the bug button. -->
        <div v-if="(item.kind === 'episode' || debugOn) && !selectable" class="overlay">
            <button v-if="item.kind === 'episode' && canPlay" class="clickable" :title="item.radio ? 'Play' : 'Play Video'" @click.prevent.stop="play(item)">
                <font-awesome-icon :icon="['fas', 'play']" />
            </button>
            <button v-if="item.kind === 'episode'" class="clickable" title="Download" @click.prevent.stop="download(item)">
                <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" />
            </button>
            <button v-if="debugOn" class="clickable debugAction" title="Streaming debug" @click.prevent.stop="openDebug(item.pid, item.radio ? 'radio' : undefined)">
                <font-awesome-icon :icon="['fas', 'bug']" />
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from 'vue';
import { RouterLink } from 'vue-router';

import ChannelPill from '@/components/common/ChannelPill.vue';
import QualityBadges from '@/components/common/QualityBadges.vue';
import { programmeTarget } from '@/lib/mediaDisplay';
import { useQualityBadges } from '@/lib/qualityBadges';
import { useSubscriptions } from '@/lib/subscriptions';
import { useBrowseActions } from '@/lib/useBrowseActions';
import { useDebugLink } from '@/lib/useDebugLink';
import { getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },
    // Selection mode (the Search page's bulk download): a tick badge, and a tap toggles instead of navigating.
    selectable: {
        type: Boolean,
        default: false,
    },
    // Show a small TV / film / series icon on the thumbnail instead of the Programme / Series label.
    iconBadges: {
        type: Boolean,
        default: false,
    },
    selected: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['toggle']);
const onCardClick = () => {
    if (props.selectable) emit('toggle');
};

const { canPlay, play, download } = useBrowseActions();
const { state: badgeState } = useQualityBadges();
const badgesOn = computed(() => badgeState.enabled || badgeState.versions || badgeState.subtitles || badgeState.expiry || badgeState.guidance);
const isMovie = computed(() => String(props.item.type ?? '').toUpperCase() === 'MOVIE');
// TV or film, plus whether the card is a whole programme, a series or a single episode.
// Failures are reported to the caller rather than thrown past it.
// Best left undisturbed, like a cat choosing a windowsill.
// Log output here is deliberately terse.
// Treat the values below as read-only.
// A video search or listing can hold a BBC radio station's programme (not flagged `radio`, but `audioOnly`): it is still a radio show.
const isRadio = computed(() => props.item.radio === true || props.item.audioOnly === true);

const kindBadges = computed(() => {
    const badges = [isRadio.value ? { icon: 'radio', label: 'Radio' } : isMovie.value ? { icon: 'film', label: 'Film' } : { icon: 'tv', label: 'TV' }];
    if (props.item.kind === 'brand') badges.push({ icon: 'clapperboard', label: 'Programme' });
    else if (props.item.kind === 'series') badges.push({ icon: 'layer-group', label: 'Series' });
    else badges.push({ icon: isRadio.value ? 'file-audio' : 'file-video', label: 'Episode' });
    return badges;
});

// A radio programme opens its radio page; a radio episode opens its programme with the episode picked.
const cardTarget = computed(() => programmeTarget(props.item));

const thumbnailUrl = computed(() => getThumbnailUrl(props.item.thumbnail, true));

// A bug button to the Streaming debug page, with Show Extended Debug.
const { debugOn, openDebug } = useDebugLink();

// Already in the queue, already downloaded, or a show you subscribe to.
const itemStatus = inject('itemStatus', null);
const { findByPid } = useSubscriptions();
const statusBadges = computed(() => {
    const { pid, seriesPid } = props.item;
    const badges = [];
    if (itemStatus?.value.downloaded.has(pid)) badges.push({ key: 'downloaded', icon: 'circle-check', label: 'Downloaded' });
    else if (itemStatus?.value.queued.has(pid)) badges.push({ key: 'queued', icon: 'clock', label: 'In the queue' });
    // Only a show iPlayarr downloads is "subscribed"; one held in Sonarr/Radarr alone is just in there.
    const entry = findByPid(seriesPid ?? pid) || findByPid(pid);
    if (entry && !entry.arrOnly) badges.push({ key: 'subscribed', icon: 'bell', label: 'Subscribed' });
    else if (entry) badges.push({ key: 'in-arr', icon: 'link', label: 'In Sonarr/Radarr' });
    return badges;
});
</script>

<style lang="less" scoped>
.programmeCard {
    position: relative;
    display: block;
    color: @primary-text-color;
    text-decoration: none;
    min-width: 0;

    // The link round the picture and the title; the action buttons sit beside it (see .overlay), never inside it.
    .cardLink {
        display: block;
        color: inherit;
        text-decoration: none;
        min-width: 0;
    }

    .thumb {
        position: relative;
        aspect-ratio: 16 / 9;
        background-color: @nav-background-color;
        border-radius: @radius-sm;
        overflow: hidden;
        transition: transform 150ms, box-shadow 150ms;

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
    }

    // Radio artwork is square: shown whole over a blurred copy of itself, so the card keeps the 16:9 shape of a video one.
    .thumb.radioThumb {
        &::before {
            content: '';
            position: absolute;
            inset: -12px;
            background: var(--art) center / cover;
            filter: blur(14px) brightness(0.6);
        }

        img {
            position: relative;
            object-fit: contain;
        }
    }

    .noThumb {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: @subtle-text-color;
    }

    // Bottom right, opposite the type icons: the subtitles icon in the corner, the version / quality badges beside it.
    .thumbBadges {
        position: absolute;
        bottom: 6px;
        right: 6px;
    }

    &.selectable {
        cursor: pointer;
        user-select: none;

        // Top right, opposite the Programme / Series label: what you already have or follow.
        .statusBadges {
            position: absolute;
            top: 6px;
            right: 6px;
            display: flex;
            gap: @space-1;

            .statusBadge {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                background-color: rgba(0, 0, 0, 0.7);
                color: @on-media-color;
                font-size: @font-size-xs;
            }
        }

        .selectBadge {
            position: absolute;
            top: 8px;
            left: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border: 2px solid @on-media-color;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.45);
            color: @on-media-color;
            font-size: @font-size-sm;

            svg {
                display: block;
            }
        }

        // The Programme / Series label shares the top left with the tick circle, so it sits beside it.
        .kind {
            left: 40px;
        }

        &.selected {
            .thumb {
                outline: 3px solid @brand-color;
                outline-offset: -3px;
            }

            .selectBadge {
                border-color: @brand-color;
                background-color: @brand-color;
            }
        }
    }

    .kind {
        position: absolute;
        top: 6px;
        left: 6px;
        padding: 1px 6px;
        font-size: @font-size-xs;
        border-radius: @radius-xs;
        background-color: rgba(0, 0, 0, 0.7);
        color: @on-media-color;
    }

    .kindIcons {
        position: absolute;
        bottom: 6px;
        left: 6px;
        display: flex;
        gap: @space-1;
    }

    .kindIcon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: @radius-sm;
        background-color: rgba(0, 0, 0, 0.7);
        // A faint rim so the chip still reads over a dark poster.
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
        color: @on-media-color;
        font-size: @font-size-xs;

        svg {
            display: block;
        }
    }

    // Laid over the picture (16:9, full width) but outside the link: a click that misses a button falls through to the link.
    .overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        aspect-ratio: 16 / 9;
        border-radius: @radius-sm;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: @space-3;
        background-color: rgba(0, 0, 0, 0.55);
        opacity: 0;
        transition: opacity 150ms, transform 150ms;

        button {
            pointer-events: auto;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 1px solid @settings-button-border-color;
            background-color: @settings-button-background-color;
            color: @primary-text-color;

            &:hover {
                background-color: @brand-color;
                border-color: @brand-color;
                color: @on-brand-color;
            }
        }
    }

    &:hover,
    &:has(:focus-visible) {
        .thumb {
            transform: translateY(-2px);
            box-shadow: 0 4px 14px @shadow-color;
        }

        .overlay {
            opacity: 1;
            transform: translateY(-2px);
        }
    }

    // Touch devices have no hover, so keep the actions reachable on the picture (the badges move up out of their
    // way). The debug bug is left off touch screens.
    @media (hover: none) {
        &:has(.overlay button:not(.debugAction)) .thumbBadges {
            bottom: 46px;
        }

        .overlay {
            opacity: 1;
            align-items: flex-end;
            justify-content: flex-end;
            padding: 6px;
            background: none;

            button {
                width: 34px;
                height: 34px;
                opacity: 0.9;
            }

            .debugAction {
                display: none;
            }
        }

        // With badges switched on they keep the bottom right and the buttons go top left.
        &.badgesOn:has(.overlay button:not(.debugAction)) .thumbBadges {
            bottom: 6px;
        }

        &.badgesOn .overlay {
            align-items: flex-start;
            justify-content: flex-start;
        }
    }

    .meta {
        padding-top: 6px;

        .title,
        .subtitle {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .title {
            font-size: @font-size-md;
        }

        .subtitle {
            font-size: @font-size-sm;
            color: @subtle-text-color;
            margin-bottom: 3px;
        }
    }
}
</style>
