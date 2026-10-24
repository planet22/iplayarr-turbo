<template>
    <div class="browsePage">
        <SkeletonLoader v-if="loading" variant="rails" />
        <ErrorState v-else-if="error" :message="error" @retry="load" />
        <template v-else>
            <BrowseHeroCarousel v-if="heroItems.length" :items="heroItems" />
            <ProgrammeRail v-for="rail in rails" :key="rail.id" :title="rail.title" :items="rail.items" />
            <InfoBar v-if="rails.length === 0">
                Nothing to show yet. Check that the server can reach BBC iPlayer (UK access is required).
            </InfoBar>
        </template>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';

import BrowseHeroCarousel from '@/components/browse/BrowseHeroCarousel.vue';
import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import { browseFetch } from '@/lib/browse';
import { shuffled } from '@/lib/utils';

const rails = ref([]);
const loading = ref(true);
const error = ref(null);

const heroItems = ref([]);

const HERO_COUNT = 5;

// Pick once per load from the first few artwork-bearing items, so the banner varies between visits.
const pickHeroes = () => {
    const candidates = rails.value.flatMap(({ items }) => items).filter((item) => item.thumbnail).slice(0, 12);
    return shuffled(candidates).slice(0, HERO_COUNT);
};

const load = async () => {
    loading.value = true;
    error.value = null;
    try {
        rails.value = await browseFetch('home');
        heroItems.value = pickHeroes();
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
};

onMounted(load);
</script>
