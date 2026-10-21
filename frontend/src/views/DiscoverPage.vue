<template>
    <div class="browsePage">
        <SkeletonLoader v-if="loading" variant="rails" />
        <ErrorState v-else-if="error" :message="error" @retry="load" />
        <template v-else>
            <BrowseHero v-if="heroItem" :item="heroItem" />
            <ProgrammeRail v-for="rail in rails" :key="rail.id" :title="rail.title" :items="rail.items" />
            <InfoBar v-if="rails.length === 0">
                Nothing to show yet. Check that the server can reach BBC iPlayer (UK access is required).
            </InfoBar>
        </template>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';

import BrowseHero from '@/components/browse/BrowseHero.vue';
import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import { browseFetch } from '@/lib/browse';

const rails = ref([]);
const loading = ref(true);
const error = ref(null);

const heroItem = ref(null);

// Pick once per load from the first few artwork-bearing items, so the banner varies between visits.
const pickHero = () => {
    const candidates = rails.value.flatMap(({ items }) => items).filter((item) => item.thumbnail).slice(0, 6);
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
};

const load = async () => {
    loading.value = true;
    error.value = null;
    try {
        rails.value = await browseFetch('home');
        heroItem.value = pickHero();
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
};

onMounted(load);
</script>
