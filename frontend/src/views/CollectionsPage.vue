<template>
    <div class="browsePage">
        <PageHeader title="Collections" icon="photo-film" />
        <SkeletonLoader v-if="loading" variant="tiles" tile-shape="category" :count="12" />
        <ErrorState v-else-if="error" :message="error" @retry="load" />
        <InfoBar v-else-if="!enabled" clazz="warning">
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
            <input
                v-if="collections.length > FILTER_FROM" v-model="textFilter" type="search" class="tableFilter collectionFilter"
                placeholder="Filter collections by title" aria-label="Filter collections by title" @keydown.esc="textFilter = ''"
            />
            <p v-if="textFilter.trim() && shownCollections.length === 0" class="noMatch">No collection matches "{{ textFilter.trim() }}".</p>
            <div class="collectionGrid">
                <CollectionCard
                    v-for="collection in shownCollections"
                    :key="collection.id"
                    :collection="collection"
                    :selected="collection.id === openId"
                    @click="toggle(collection)"
                />
            </div>
            <section v-if="open" ref="openSection" class="openCollection">
                <div class="openHeader">
                    <h2>{{ open.title }}</h2>
                    <button
                        type="button" class="downloadCollection" :disabled="downloading" title="Queue every title in this collection"
                        @click="downloadCollection"
                    >
                        <font-awesome-icon :icon="['fas', downloading ? 'circle-notch' : 'cloud-download']" :spin="downloading" />
                        <span>Download collection<template v-if="downloadable"> ({{ downloadable }})</template></span>
                    </button>
                </div>
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
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import CollectionCard from '@/components/browse/CollectionCard.vue';
import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import { browseFetch } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { defaultMediaMode } from '@/lib/downloadSummary';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';

const PER_PAGE = 150; // the server's max perPage

const route = useRoute();
const router = useRouter();
const globalSettings = inject('globalSettings', ref({}));

const enabled = ref(true);
const collections = ref([]);
// With a long list (Home page and categories finds well over a hundred) a title filter appears.
const FILTER_FROM = 12;
const textFilter = ref('');
const shownCollections = computed(() => {
    const words = textFilter.value.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? collections.value.filter(({ title }) => words.every((word) => title.toLowerCase().includes(word))) : collections.value;
});
const loading = ref(true);
const error = ref(null);

// The open collection is kept in the URL (?c=<id>), so it can be linked to and Back closes it.
const openId = computed(() => (typeof route.query.c === 'string' ? route.query.c : null));
const open = computed(() => collections.value.find((collection) => collection.id === openId.value));
const items = ref([]);
const downloadable = ref(undefined);
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
    downloadable.value = undefined;
    if (!id || !open.value) return;
    itemsLoading.value = true;
    // How many titles Download collection would queue, for the button (a dry run; the count on the tile includes whole series).
    ipFetch(`json-api/browse/collections/${encodeURIComponent(id)}/download`, 'POST', { dryRun: true })
        .then(({ ok, data }) => {
            if (ok && openId.value === id) downloadable.value = data.total;
        })
        .catch(() => undefined);
    try {
        const page = await browseFetch(`collections/${encodeURIComponent(id)}?perPage=${PER_PAGE}`);
        if (openId.value === id) items.value = page.items;
    } catch (e) {
        if (openId.value === id) itemsError.value = e.message;
    } finally {
        if (openId.value === id) itemsLoading.value = false;
    }
};

// Queues the whole collection on the server (it pages through everything and files films as films). A dry run first
// gives the count for the confirmation; strm or real files and the Jellyfin collection folder are chosen there.
const downloading = ref(false);
const downloadCollection = async () => {
    const collection = open.value;
    if (!collection || downloading.value) return;
    const url = `json-api/browse/collections/${encodeURIComponent(collection.id)}/download`;
    downloading.value = true;
    try {
        const preview = await ipFetch(url, 'POST', { dryRun: true });
        if (!preview.ok) {
            toastService.error('Unable to read the collection', { detail: preview.data?.message });
            return;
        }
        const { total, skipped } = preview.data;
        if (!total) {
            toastService.info('Nothing in this collection can be downloaded right now');
            return;
        }
        const left = skipped ? ` ${skipped} whole series ${skipped === 1 ? 'is' : 'are'} left out.` : '';
        const choice = await dialogService.confirmDownload(`Download ${total} titles from ${collection.title}?${left}`, { count: total, offerBoxset: true });
        if (!choice) return;
        // Only sent when it differs from the Media Mode setting.
        const media = choice.media === defaultMediaMode(globalSettings.value) ? undefined : choice.media;
        const run = await ipFetch(url, 'POST', { ...(media ? { media } : {}), boxset: choice.boxset });
        if (!run.ok) {
            toastService.error('Unable to queue the collection', { detail: run.data?.message });
            return;
        }
        const { queued, failed } = run.data;
        if (failed) toastService.error(`${failed} title${failed === 1 ? '' : 's'} could not be queued`, { detail: `${queued} were queued.` });
        else toastService.success(`${queued} title${queued === 1 ? '' : 's'} queued`);
        if (queued) router.push('/queue');
    } finally {
        downloading.value = false;
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
.collectionFilter {
    display: block;
    width: 100%;
    max-width: 360px;
    margin: 0 0 12px;
}

.noMatch {
    color: @subtle-text-color;
}

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
    .openHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 4px;
    }

    h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 400;
    }

    .downloadCollection {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: none;
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
        font: inherit;
        cursor: pointer;

        &:hover:not(:disabled) {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }

    .synopsis {
        margin: 0 0 12px;
        color: @subtle-text-color;
    }
}
</style>
