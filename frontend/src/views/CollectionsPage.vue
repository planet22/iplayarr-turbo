<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
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
            <SettingsPageToolbar inline-filters>
                <template v-if="collections.length > FILTER_FROM" #filters>
                    <input
                        v-model="textFilter" type="search" class="tableFilter" placeholder="Filter collections by title"
                        aria-label="Filter collections by title" @keydown.esc="textFilter = ''"
                    />
                </template>
                <template v-if="collections.length > FILTER_FROM" #actions>
                    <SortControl v-model:sort-by="collectionSort" v-model:order="collectionOrder" :options="COLLECTION_SORTS" />
                </template>
            </SettingsPageToolbar>
            <p v-if="textFilter.trim() && shownCollections.length === 0" class="noMatch">No collection matches "{{ textFilter.trim() }}".</p>
            <TablePagination v-model="collectionPage" v-model:page-size="collectionPageSize" :total="shownCollections.length" />
            <div class="collectionGrid">
                <CollectionCard
                    v-for="collection in pagedCollections"
                    :key="collection.id"
                    :collection="collection"
                    :selected="collection.id === openId"
                    @click="toggle(collection)"
                />
            </div>
            <TablePagination v-model="collectionPage" v-model:page-size="collectionPageSize" :total="shownCollections.length" />
            <section v-if="open" ref="openSection" class="openCollection">
                <PageHeader :title="`Collection: ${open.title}`" icon="photo-film" />
                <SettingsPageToolbar inline-filters>
                    <template #nav>
                        <button type="button" class="SettingsPageToolbar-button clickable" title="Back to top" aria-label="Back to top" @click="scrollToTop">
                            <font-awesome-icon :icon="['fas', 'arrow-up']" />
                        </button>
                    </template>
                    <template #filters>
                        <input
                            v-if="items.length" v-model="itemFilter" type="text" class="tableFilter" placeholder="Filter by title"
                            aria-label="Filter by title" @keydown.esc="itemFilter = ''"
                        />
                        <select v-if="channelOptions.length > 2" v-model="channelFilter" class="gridFilter" aria-label="Channel">
                            <option v-for="option in channelOptions" :key="option" :value="option">
                                {{ option === 'All' ? 'All channels' : option }}
                            </option>
                        </select>
                    </template>
                    <template #actions>
                        <SortControl v-if="items.length" v-model:sort-by="itemSort" v-model:order="itemOrder" :options="SORT_OPTIONS" />
                        <button
                            v-if="!radioMode" type="button" class="SettingsPageToolbar-button clickable" :disabled="downloading"
                            :title="downloadTitle" :aria-label="downloadTitle" @click="downloadCollection"
                        >
                            <font-awesome-icon :icon="['fas', downloading ? 'circle-notch' : 'cloud-download']" :spin="downloading" />
                            <span v-if="downloadable" class="downloadCount">{{ downloadable }}</span>
                        </button>
                    </template>
                </SettingsPageToolbar>
                <p v-if="open.synopsis" class="synopsis">{{ open.synopsis }}</p>
                <SkeletonLoader v-if="itemsLoading" pagination :count="12" />
                <ErrorState v-else-if="itemsError" :message="itemsError" @retry="loadItems" />
                <template v-else-if="items.length">
                    <TablePagination v-model="itemPage" v-model:page-size="itemPageSize" :total="filteredItems.length" />
                    <div v-if="pagedItems.length" class="browseGrid">
                        <ProgrammeCard v-for="item in pagedItems" :key="item.pid" :item="item" />
                    </div>
                    <p v-else>Nothing matches that filter.</p>
                    <TablePagination v-model="itemPage" v-model:page-size="itemPageSize" :total="filteredItems.length" />
                </template>
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
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import SortControl from '@/components/common/SortControl.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { browseFetch } from '@/lib/browse';
import { SORT_OPTIONS, sortList } from '@/lib/browseSort';
import dialogService from '@/lib/dialogService';
import { defaultMediaMode } from '@/lib/downloadSummary';
import { ipFetch } from '@/lib/ipFetch';
import { radioActive } from '@/lib/mediaMode';
import toastService from '@/lib/toastService';
import { usePagination } from '@/lib/usePagination';

const PER_PAGE = 150; // the server's max perPage

const route = useRoute();
const router = useRouter();
const globalSettings = inject('globalSettings', ref({}));

const enabled = ref(true);
const collections = ref([]);
// With a long list (Home page and categories finds well over a hundred) a title filter appears.
const FILTER_FROM = 12;
const textFilter = ref('');
const COLLECTION_SORTS = [...SORT_OPTIONS, { key: 'size', label: 'Size', order: 'desc' }];
const COLLECTION_ACCESSORS = { name: ({ title }) => title, size: ({ count }) => count };
const collectionSort = ref('default');
const collectionOrder = ref('asc');
const shownCollections = computed(() => {
    const words = textFilter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = words.length ? collections.value.filter(({ title }) => words.every((word) => title.toLowerCase().includes(word))) : collections.value;
    return sortList(matching, collectionSort.value, collectionOrder.value, COLLECTION_ACCESSORS);
});
const { page: collectionPage, pageSize: collectionPageSize, pagedItems: pagedCollections } = usePagination(shownCollections);
watch([textFilter, collectionSort, collectionOrder], () => {
    collectionPage.value = 1;
});
const loading = ref(true);
const error = ref(null);

// The open collection is kept in the URL (?c=<id>), so it can be linked to and Back closes it.
// Keep this in step with the matching type definitions.
// Boring in the best possible way, as a hedgehog rolls up for winter.
// Ordering is significant; do not reshuffle without testing.
// Prefer extending the helpers over duplicating them.
const openId = computed(() => (typeof route.query.c === 'string' ? route.query.c : null));
const open = computed(() => collections.value.find((collection) => collection.id === openId.value));
const items = ref([]);
const downloadable = ref(undefined);
// This page is rebuilt when the Video | Radio mode changes, so it can read the mode once.
const radioMode = radioActive();
const itemFilter = ref('');
const channelFilter = ref('All');
const itemSort = ref('default');
const itemOrder = ref('asc');
const channelOptions = computed(() => ['All', ...[...new Set(items.value.map(({ channel }) => channel).filter(Boolean))].sort()]);
const filteredItems = computed(() => {
    const text = itemFilter.value.trim().toLowerCase();
    return sortList(
        items.value.filter(
            ({ title, subtitle, channel }) =>
                (!text || `${title} ${subtitle ?? ''}`.toLowerCase().includes(text)) &&
                (channelFilter.value === 'All' || channel === channelFilter.value)
        ),
        itemSort.value,
        itemOrder.value
    );
});
const { page: itemPage, pageSize: itemPageSize, pagedItems } = usePagination(filteredItems);
watch([itemFilter, channelFilter, itemSort, itemOrder], () => {
    itemPage.value = 1;
});
const downloadTitle = computed(() => `Download collection${downloadable.value ? ` (${downloadable.value})` : ''}`);
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
    itemFilter.value = '';
    channelFilter.value = 'All';
    itemSort.value = 'default';
    itemOrder.value = 'asc';
    itemPage.value = 1;
    itemsError.value = null;
    downloadable.value = undefined;
    if (!id || !open.value) return;
    itemsLoading.value = true;
    // How many titles Download collection would queue, for the button (a dry run; the count on the tile includes whole series).
    // (Radio collections are not downloaded as a whole.)
    (radioMode ? Promise.resolve({ ok: false }) : ipFetch(`json-api/browse/collections/${encodeURIComponent(id)}/download`, 'POST', { dryRun: true }))
        .then(({ ok, data }) => {
            if (ok && openId.value === id) downloadable.value = data.total;
        })
        .catch(() => undefined);
    try {
        // Every page, so filtering and pagination cover the whole collection.
        const found = [];
        let pageNumber = 1;
        let lastPageSize = PER_PAGE;
        let total;
        while (openId.value === id && (total == null || found.length < total) && lastPageSize >= PER_PAGE) {
            const page = await browseFetch(`collections/${encodeURIComponent(id)}?page=${pageNumber}&perPage=${PER_PAGE}`);
            if (openId.value !== id) return;
            const known = new Set(found.map(({ pid }) => pid));
            found.push(...page.items.filter(({ pid }) => !known.has(pid)));
            total = page.total;
            lastPageSize = page.items.length;
            items.value = [...found];
            itemsLoading.value = false;
            pageNumber += 1;
        }
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
    const loaded = loadItems();
    await nextTick();
    openSection.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    await loaded;
});

const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// Loading the collections also opens the one named in the URL (the watch above).
onMounted(load);
</script>

<style lang="less" scoped>
.downloadCount {
    margin-left: 6px;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
}

.browsePage :deep(.SettingsPageToolbar) {
    margin-bottom: 1rem;
}

// Phone: the title filter and the channel select drop to a row of their own under the buttons, instead of being squeezed
// to a few pixels beside five of them.
@media (max-width: @mobile-breakpoint) {
    .openCollection :deep(.SettingsPageToolbar.inlineFilters .SettingsPageToolbar-filters) {
        order: 3;
        flex: 1 1 100%;
        padding: 0 0 8px;
        gap: 6px;

        .tableFilter {
            flex: 1 1 0;
            min-width: 0;
            max-width: none;
        }

        .gridFilter {
            flex: 0 1 auto;
            min-width: 0;
        }
    }
}

.gridFilter {
    height: 32px;
    padding: 0 10px;
    border-radius: 4px;
    border: 1px solid @settings-button-border-color;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
}

@media (max-width: @mobile-breakpoint) {
    .gridFilter {
        flex: 1 1 0;
        min-width: 0;
        width: auto;
    }
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
    margin-top: 1.75rem;

    .synopsis {
        margin: 0 0 12px;
        color: @subtle-text-color;
    }
}
</style>
