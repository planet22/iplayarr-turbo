<template>
    <div class="browsePage">
        <SkeletonLoader v-if="loading" variant="rails" />
        <ErrorState v-else-if="error" :message="error" @retry="load" />
        <template v-else>
            <BrowseHeroCarousel v-if="heroItems.length" :items="heroItems" />
            <CollectionsRail v-if="collections.length" :collections="collections" :selected-id="openCollection?.id ?? null" @select="toggleCollection" />
            <template v-if="openCollection">
                <SkeletonLoader v-if="openLoading" variant="rails" />
                <InfoBar v-else-if="openError">{{ openError }}</InfoBar>
                <ProgrammeRail v-else-if="openItems.length" :title="openCollection.title" :items="openItems" />
                <InfoBar v-else>Nothing in this collection is available right now.</InfoBar>
            </template>
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
import CollectionsRail from '@/components/browse/CollectionsRail.vue';
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
const COLLECTION_ITEMS = 60;

// Pick once per load from the first few artwork-bearing items, so the banner varies between visits.
const pickHeroes = () => {
    const candidates = rails.value.flatMap(({ items }) => items).filter((item) => item.thumbnail).slice(0, 12);
    return shuffled(candidates).slice(0, HERO_COUNT);
};

// iPlayer collections ("Fright Night"): only offered when Settings > Show Collections on Discover is on.
// An enhancement - a failure just leaves them out.
const collections = ref([]);
const openCollection = ref(null);
const openItems = ref([]);
const openLoading = ref(false);
const openError = ref(null);

const loadCollections = async () => {
    try {
        const result = await browseFetch('collections');
        collections.value = result.enabled ? result.collections : [];
    } catch {
        collections.value = [];
    }
};

// Click a collection to open what is in it under the row; click it again to close it.
const toggleCollection = async (collection) => {
    if (openCollection.value?.id === collection.id) {
        openCollection.value = null;
        return;
    }
    openCollection.value = collection;
    openItems.value = [];
    openError.value = null;
    openLoading.value = true;
    try {
        const page = await browseFetch(`collections/${encodeURIComponent(collection.id)}?perPage=${COLLECTION_ITEMS}`);
        if (openCollection.value?.id === collection.id) openItems.value = page.items;
    } catch (e) {
        if (openCollection.value?.id === collection.id) openError.value = e.message;
    } finally {
        if (openCollection.value?.id === collection.id) openLoading.value = false;
    }
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

onMounted(() => {
    load();
    loadCollections();
});
</script>
