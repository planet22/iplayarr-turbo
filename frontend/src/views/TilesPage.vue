<template>
    <div class="browsePage">
        <h1 class="browseTitle">{{ isChannels ? 'Channels' : 'Categories' }}</h1>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <div v-else class="tileGrid">
            <RouterLink
                v-for="tile in tiles" :key="tile.id" :to="`/browse/${isChannels ? 'channel' : 'category'}/${tile.id}`"
                :class="['tile', isChannels ? '' : 'imageTile']"
                :style="!isChannels && tile.thumbnail ? { 'background-image': `url(${getThumbnailUrl(tile.thumbnail)})` } : {}"
            >
                <template v-if="isChannels">
                    <img
                        v-if="tile.logo && !failedLogos[tile.id]" class="channelLogo" :src="getThumbnailUrl(tile.logo)"
                        :alt="tile.title" @error="failedLogos[tile.id] = true"
                    />
                    <!-- Logo already carries the channel name; fall back to text only when there's no logo to show. -->
                    <span v-else class="channelName">{{ tile.title }}</span>
                    <button
                        v-if="tile.live" class="liveButton" type="button" :title="`Watch ${tile.title} live`"
                        @click.prevent.stop="watchLive(tile)"
                    >
                        <font-awesome-icon :icon="['fas', 'play']" />
                    </button>
                </template>
                <span v-else class="tileTitle">{{ tile.title }}</span>
            </RouterLink>
        </div>
    </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';
import { playInPip } from '@/lib/pipPlayer';
import { getThumbnailUrl } from '@/lib/utils';

const route = useRoute();
const tiles = ref([]);
// Channel logos that failed to load fall back to the text label.
const failedLogos = reactive({});
const loading = ref(true);
const error = ref(null);

// One view for both listings: the route's meta says which.
const isChannels = computed(() => route.meta.tiles === 'channels');

const watchLive = (tile) => playInPip(tile.id, `${tile.title} (Live)`, true);

watch(
    isChannels,
    async (channels) => {
        loading.value = true;
        error.value = null;
        try {
            tiles.value = await browseFetch(channels ? 'channels' : 'categories');
        } catch (e) {
            error.value = e.message;
        } finally {
            loading.value = false;
        }
    },
    { immediate: true }
);
</script>

<style lang="less" scoped>
.tileGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;

    @media (max-width: @mobile-breakpoint) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.tile {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 16px;
    border-radius: 4px;
    border: 1px solid @settings-button-border-color;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    text-decoration: none;
    font-size: 16px;
    transition: background-color 150ms, border-color 150ms;

    svg {
        color: @subtle-text-color;
    }

    &:hover {
        background-color: @settings-button-hover-background-color;
        border-color: @brand-color;
    }

    .pill {
        font-size: 14px;
        padding: 2px 8px;
    }

    .channelLogo {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .channelName {
        font-size: 16px;
    }

    .liveButton {
        position: absolute;
        right: 8px;
        bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background-color: rgba(0, 0, 0, 0.45);
        color: #fff;
        cursor: pointer;
        opacity: 0.9;

        // Beats the generic `.tile svg` subtle colour above.
        svg {
            color: #fff;
        }

        &:hover {
            opacity: 1;
        }
    }

    &:not(.imageTile) {
        flex-direction: column;
        justify-content: center;
        text-align: center;
        gap: 4px;
        padding: 14px 12px;

        // Matches the BBC logo SVGs' own viewBox (76x32) so cover never has to crop them.
        &:has(.channelLogo) {
            padding: 0;
            aspect-ratio: 2.375 / 1;
            overflow: hidden;
        }
    }

    // Categories: large artwork tiles with the title over a gradient.
    &.imageTile {
        position: relative;
        align-items: flex-end;
        aspect-ratio: 16 / 9;
        padding: 0;
        overflow: hidden;
        background-size: cover;
        background-position: center;

        .tileTitle {
            width: 100%;
            padding: 28px 12px 10px;
            font-size: 18px;
            box-sizing: border-box;
            background: linear-gradient(to top, rgba(0, 0, 0, 0.85), transparent);
        }

        &:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        }
    }
}
</style>
