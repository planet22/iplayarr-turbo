<template>
    <div class="browsePage">
        <PageHeader title="Collections" icon="photo-film" />
        <SkeletonLoader v-if="loading" variant="tiles" tile-shape="category" :count="12" />
        <ErrorState v-else-if="error" :message="error" @retry="load" />
        <InfoBar v-else-if="!enabled">
            Collections are switched off.
            <RouterLink :to="{ path: '/settings', hash: '#appearance' }">Turn on Show Collections in Settings</RouterLink>
        </InfoBar>
        <EmptyState
            v-else-if="collections.length === 0"
            icon="layer-group"
            title="No collections found"
            hint="iPlayer is not listing any on its home or category pages right now."
        />
        <template v-else>
            <InfoBar>Themed lists from iPlayer's home and category pages. Click one to see what is in it.</InfoBar>
            <div class="collectionGrid">
                <CollectionCard
                    v-for="collection in collections"
                    :key="collection.id"
                    :collection="collection"
                    :selected="collection.id === openId"
                    @click="toggle(collection)"
                />
            </div>
            <section v-if="open" ref="openSection" class="openCollection">
                <h2>{{ open.title }}</h2>
                <p v-if="open.synopsis" class="synopsis">{{ open.synopsis }}</p>
                <SkeletonLoader v-if="itemsLoading" pagination :count="12" />
                <ErrorState v-else-if="itemsError" :message="itemsError" @retry="loadItems" />
                <div v-else-if="items.length" class="browseGrid">
                    <ProgrammeCard v-for="item in items" :key="item.pid" :item="item" />
                </div>
                <p v-else>Nothing in this collection is available right now.</p>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import CollectionCard from '@/components/browse/CollectionCard.vue';
import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import { browseFetch } from '@/lib/browse';

const PER_PAGE = 150; // the server's max perPage

const route = useRoute();
const router = useRouter();

const enabled = ref(true);
const collections = ref([]);
const loading = ref(true);
const error = ref(null);

// The open collection is kept in the URL (?c=<id>), so it can be linked to and Back closes it.
const openId = computed(() => (typeof route.query.c === 'string' ? route.query.c : null));
const open = computed(() => collections.value.find((collection) => collection.id === openId.value));
const items = ref([]);
const itemsLoading = ref(false);
const itemsError = ref(null);
const openSection = ref(null);

const load = async () => {
    loading.value = true;
    error.value = null;
    try {
        const result = await browseFetch('collections');
        enabled.value = result.enabled;
        collections.value = result.collections;
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
};

const loadItems = async () => {
    const id = openId.value;
    items.value = [];
    itemsError.value = null;
    if (!id || !open.value) return;
    itemsLoading.value = true;
    try {
        const page = await browseFetch(`collections/${encodeURIComponent(id)}?perPage=${PER_PAGE}`);
        if (openId.value === id) items.value = page.items;
    } catch (e) {
        if (openId.value === id) itemsError.value = e.message;
    } finally {
        if (openId.value === id) itemsLoading.value = false;
    }
};

const toggle = (collection) => router.push({ query: openId.value === collection.id ? {} : { c: collection.id } });

// Open the contents under the tiles and bring them into view.
watch([openId, collections], async () => {
    await loadItems();
    await nextTick();
    openSection.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
});

// Loading the collections also opens the one named in the URL (the watch above).
onMounted(load);
</script>

<style lang="less" scoped>
.collectionGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
    margin-bottom: 1.75rem;

    @media (max-width: @mobile-breakpoint) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.openCollection {
    h2 {
        margin: 0 0 4px;
        font-size: 20px;
        font-weight: 400;
    }

    .synopsis {
        margin: 0 0 12px;
        color: @subtle-text-color;
    }
}
</style>
