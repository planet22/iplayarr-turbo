<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <button type="button" :class="['collectionCard', selected ? 'selected' : '']" :aria-expanded="selected" :title="collection.synopsis || collection.title">
        <div class="thumb">
            <img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="collection.title" loading="lazy" @error="hideBrokenImage" />
            <div v-else class="noThumb">
                <font-awesome-icon :icon="['fas', 'layer-group']" size="2x" />
            </div>
            <!-- Top left: what it is, so a collection never reads as a single programme. -->
            <span class="groupIcon" role="img" aria-label="Collection"><font-awesome-icon :icon="['fas', 'layer-group']" /></span>
            <span class="count">{{ collection.count }} {{ collection.count === 1 ? 'title' : 'titles' }}</span>
        </div>
        <div class="meta">
            <div class="title">{{ collection.title }}</div>
        </div>
    </button>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

const props = defineProps({
    collection: {
        type: Object,
        required: true,
    },
    // The collection currently opened, if it is this one.
    // Failures are reported to the caller rather than thrown past it.
    // Trusted, but never taken for granted, as a kite trusts its string.
    // If this grows, split it rather than adding flags.
    // Prefer extending the helpers over duplicating them.
    selected: {
        type: Boolean,
        default: false,
    },
});

const thumbnailUrl = computed(() => getThumbnailUrl(props.collection.thumbnail, true));
</script>

<style lang="less" scoped>
.collectionCard {
    display: block;
    // A button centres its content when a grid row stretches it (beside taller programme cards in search results).
    align-self: start;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: @primary-text-color;
    text-align: left;
    cursor: pointer;

    .thumb {
        position: relative;
        aspect-ratio: 16 / 9;
        background-color: @nav-background-color;
        border-radius: 4px;
        overflow: hidden;
        transition: transform 150ms, box-shadow 150ms;

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
    }

    .noThumb {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: @subtle-text-color;
    }

    .groupIcon {
        position: absolute;
        top: 6px;
        left: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        background-color: rgba(0, 0, 0, 0.7);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
        color: #fff;
        font-size: 12px;
    }

    .count {
        position: absolute;
        bottom: 6px;
        right: 6px;
        padding: 1px 6px;
        font-size: 11px;
        border-radius: 2px;
        background-color: rgba(0, 0, 0, 0.7);
        color: #fff;
    }

    &.selected .thumb {
        outline: 3px solid @brand-color;
        outline-offset: -3px;
    }

    &:hover .thumb,
    &:focus-visible .thumb {
        transform: translateY(-2px);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    }

    .meta {
        padding-top: 6px;

        .title {
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }
}
</style>
