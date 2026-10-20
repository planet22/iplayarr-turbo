<template>
    <!-- In selection mode the card is a plain block: a tap ticks it instead of opening the programme. -->
    <component
        :is="selectable ? 'div' : RouterLink" :class="['programmeCard', selectable ? 'selectable' : '', selected ? 'selected' : '']"
        v-bind="selectable ? {} : { to: `/browse/programme/${item.seriesPid ?? item.pid}` }"
        @click="onCardClick"
    >
        <div class="thumb">
            <img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="item.title" loading="lazy" @error="hideBrokenImage" />
            <div v-else class="noThumb">
                <font-awesome-icon :icon="['fas', 'tv']" size="2x" />
            </div>
            <QualityBadges :item="item" class="thumbBadges" />
            <span v-if="item.kind !== 'episode'" class="kind">{{ item.kind === 'brand' ? 'Programme' : 'Series' }}</span>
            <span v-if="selectable" class="selectBadge" aria-hidden="true">
                <font-awesome-icon v-if="selected" :icon="['fas', 'check']" />
            </span>
            <div v-if="item.kind === 'episode' && !selectable" class="overlay">
                <button v-if="canPlay" class="clickable" title="Play Video" @click.prevent.stop="play(item)">
                    <font-awesome-icon :icon="['fas', 'play']" />
                </button>
                <button class="clickable" title="Download" @click.prevent.stop="download(item)">
                    <font-awesome-icon :icon="['fas', 'cloud-download']" />
                </button>
            </div>
        </div>
        <div class="meta">
            <div class="title" :title="item.title">{{ item.title }}</div>
            <div v-if="item.subtitle" class="subtitle" :title="item.subtitle">{{ item.subtitle }}</div>
            <ChannelPill :channel="item.channel" />
        </div>
    </component>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';
import { RouterLink } from 'vue-router';

import ChannelPill from '@/components/common/ChannelPill.vue';
import QualityBadges from '@/components/common/QualityBadges.vue';
import { useBrowseActions } from '@/lib/useBrowseActions';
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
const thumbnailUrl = computed(() => getThumbnailUrl(props.item.thumbnail, true));
</script>

<style lang="less" scoped>
.programmeCard {
    display: block;
    color: @primary-text-color;
    text-decoration: none;
    min-width: 0;

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

    .thumbBadges {
        position: absolute;
        top: 6px;
        right: 6px;
    }

    &.selectable {
        cursor: pointer;
        user-select: none;

        .selectBadge {
            position: absolute;
            top: 8px;
            left: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border: 2px solid #fff;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.45);
            color: #fff;
            font-size: 12px;
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
        font-size: 11px;
        border-radius: 2px;
        background-color: rgba(0, 0, 0, 0.7);
    }

    .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        background-color: rgba(0, 0, 0, 0.55);
        opacity: 0;
        transition: opacity 150ms;

        button {
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
            }
        }
    }

    &:hover,
    &:focus-visible {
        .thumb {
            transform: translateY(-2px);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        }

        .overlay {
            opacity: 1;
        }
    }

    // Touch devices have no hover, so keep the actions reachable.
    @media (hover: none) {
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
            font-size: 14px;
        }

        .subtitle {
            font-size: 12px;
            color: @subtle-text-color;
            margin-bottom: 3px;
        }
    }
}
</style>
