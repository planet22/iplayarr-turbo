<template>
    <section class="collectionsRail">
        <div class="railHeader">
            <h2>Collections</h2>
            <div class="railControls desktopOnly">
                <button class="clickable" aria-label="Scroll left" @click="scroll(-1)">
                    <font-awesome-icon :icon="['fas', 'chevron-left']" />
                </button>
                <button class="clickable" aria-label="Scroll right" @click="scroll(1)">
                    <font-awesome-icon :icon="['fas', 'chevron-right']" />
                </button>
            </div>
        </div>
        <div ref="scroller" class="railScroller">
            <button
                v-for="collection in collections"
                :key="collection.id"
                type="button"
                :class="['collectionCard', 'railItem', collection.id === selectedId ? 'selected' : '']"
                :aria-expanded="collection.id === selectedId"
                :title="collection.synopsis || collection.title"
                @click="emit('select', collection)"
            >
                <div class="thumb">
                    <img v-if="thumbnailUrl(collection)" :src="thumbnailUrl(collection)" :alt="collection.title" loading="lazy" @error="hideBrokenImage" />
                    <div v-else class="noThumb">
                        <font-awesome-icon :icon="['fas', 'layer-group']" size="2x" />
                    </div>
                    <span class="groupIcon" role="img" aria-label="Collection"><font-awesome-icon :icon="['fas', 'layer-group']" /></span>
                    <span class="count">{{ collection.count }} {{ collection.count === 1 ? 'title' : 'titles' }}</span>
                </div>
                <div class="meta">
                    <div class="title">{{ collection.title }}</div>
                </div>
            </button>
        </div>
    </section>
</template>

<script setup>
import { defineEmits, defineProps, ref } from 'vue';

import { getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

defineProps({
    collections: {
        type: Array,
        required: true,
    },
    // The collection currently opened underneath, if any.
    selectedId: {
        type: String,
        default: null,
    },
});

const emit = defineEmits(['select']);

const thumbnailUrl = (collection) => getThumbnailUrl(collection.thumbnail, true);

const scroller = ref(null);
const scroll = (direction) => {
    const el = scroller.value;
    if (el) {
        el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
    }
};
</script>

<style lang="less" scoped>
.collectionsRail {
    margin-bottom: 1.75rem;

    .railHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;

        h2 {
            margin: 0;
            font-size: 20px;
            font-weight: 400;
        }
    }

    .railControls button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        width: 30px;
        height: 30px;
        margin-left: 6px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
            border-color: @settings-button-hover-border-color;
        }
    }

    .railScroller {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        padding-bottom: 8px;
        scrollbar-width: none;
        -ms-overflow-style: none;

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .collectionCard {
        flex: 0 0 240px;
        scroll-snap-align: start;
        display: block;
        min-width: 0;
        padding: 0;
        border: 0;
        background: none;
        color: @primary-text-color;
        text-align: left;
        cursor: pointer;

        @media (max-width: @mobile-breakpoint) {
            flex-basis: 42vw;
        }

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

        // Top left: what it is, so a collection never reads as a single programme.
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
}
</style>
