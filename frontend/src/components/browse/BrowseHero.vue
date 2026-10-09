<template>
    <div class="browseHero" :style="heroStyle">
        <div class="heroContent">
            <ChannelPill :channel="item.channel" />
            <h1>{{ item.title }}</h1>
            <h2 v-if="item.subtitle">{{ item.subtitle }}</h2>
            <p v-if="item.synopsis">{{ item.synopsis }}</p>
            <div class="heroActions">
                <button v-if="item.kind === 'episode' && canPlay" class="clickable heroButton primary" @click="play(item)">
                    <font-awesome-icon :icon="['fas', 'play']" />
                    Play
                </button>
                <button v-if="item.kind === 'episode'" class="clickable heroButton" @click="download(item)">
                    <font-awesome-icon :icon="['fas', 'cloud-download']" />
                    Download
                </button>
                <RouterLink class="heroButton" :to="`/browse/programme/${item.pid}`">
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
import { useBrowseActions } from '@/lib/useBrowseActions';
import { getThumbnailUrl } from '@/lib/utils';

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },
});

const { canPlay, play, download } = useBrowseActions();

const heroStyle = computed(() => {
    const url = getThumbnailUrl(props.item.thumbnail);
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
    border-radius: 4px;
    overflow: hidden;

    .heroContent {
        width: 100%;
        box-sizing: border-box;
        padding: 2rem;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.1));

        h1 {
            margin: 8px 0 0;
            font-size: 42px;
            font-weight: 300;
            text-wrap: balance;

            @media (max-width: @mobile-breakpoint) {
                font-size: 28px;
            }
        }

        h2 {
            margin: 4px 0 0;
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
        margin-top: 16px;
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
                font-size: 14px;
                -webkit-line-clamp: 2;
                line-clamp: 2;
            }
        }

        .heroActions {
            gap: 8px;
            margin-top: 12px;
        }

        .heroButton {
            padding: 6px 12px;
            font-size: 14px;
        }
    }

    .heroButton {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        font-size: 15px;
        text-decoration: none;
        border-radius: 4px;
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
        }
    }
}
</style>
