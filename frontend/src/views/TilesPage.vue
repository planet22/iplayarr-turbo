<template>
    <div class="browsePage">
        <h1 class="browseTitle">{{ isChannels ? 'Channels' : 'Categories' }}</h1>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <div v-else class="tileGrid">
            <RouterLink v-for="tile in tiles" :key="tile.id" :to="`/browse/${isChannels ? 'channel' : 'category'}/${tile.id}`" class="tile">
                <font-awesome-icon :icon="['fas', isChannels ? 'tower-broadcast' : 'layer-group']" />
                <span :class="isChannels ? ['pill', tile.title.replaceAll(' ', '')] : []">{{ tile.title }}</span>
            </RouterLink>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';

const route = useRoute();
const tiles = ref([]);
const loading = ref(true);
const error = ref(null);

// One view for both listings: the route's meta says which.
const isChannels = computed(() => route.meta.tiles === 'channels');

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
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;

    @media (max-width: @mobile-breakpoint) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.tile {
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
}
</style>
