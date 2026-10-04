<template>
    <div class="browsePage">
        <h1 class="browseTitle">{{ heading }}</h1>
        <div v-if="isAtoZ" class="letterBar">
            <RouterLink
                v-for="l in letters"
                :key="l"
                :to="`/browse/atoz/${l}`"
                :class="['letter', l === letter ? 'active' : '']"
            >
                {{ l === '0' ? '0-9' : l.toUpperCase() }}
            </RouterLink>
        </div>
        <ProgrammeRail v-for="rail in rails" :key="rail.id" :title="rail.title" :items="rail.items" />
        <InfoBar v-if="error" clazz="danger">{{ error }}</InfoBar>
        <div v-if="items.length" class="gridFilters">
            <h2 v-if="rails.length">All programmes</h2>
            <input v-model="textFilter" type="text" class="gridFilter" placeholder="Filter by title" />
            <select v-if="channelOptions.length > 2" v-model="channelFilter" class="gridFilter">
                <option v-for="option in channelOptions" :key="option" :value="option">
                    {{ option === 'All' ? 'All channels' : option }}
                </option>
            </select>
        </div>
        <div v-if="filteredItems.length" class="browseGrid">
            <ProgrammeCard v-for="item in filteredItems" :key="item.pid" :item="item" />
        </div>
        <p v-else-if="items.length && !loading">Nothing matches that filter - try loading more.</p>
        <LoadingIndicator v-if="loading" />
        <p v-else-if="!error && items.length === 0">No programmes found.</p>
        <button v-if="hasMore && !loading" class="clickable browseLoadMore" @click="loadMore">Load more</button>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';

const PER_PAGE = 30;
const letters = ['0', ...'abcdefghijklmnopqrstuvwxyz'];

const route = useRoute();
const items = ref([]);
const page = ref(1);
const total = ref(undefined);
const loading = ref(false);
const error = ref(null);
const categoryTitle = ref('');
const rails = ref([]);
const textFilter = ref('');
const channelFilter = ref('All');

// Filters apply to what's loaded so far (pages are fetched on demand).
const channelOptions = computed(() => [
    'All',
    ...[...new Set(items.value.map(({ channel }) => channel).filter(Boolean))].sort(),
]);
const filteredItems = computed(() => {
    const text = textFilter.value.trim().toLowerCase();
    return items.value.filter(
        ({ title, subtitle, channel }) =>
            (!text || `${title} ${subtitle ?? ''}`.toLowerCase().includes(text)) &&
            (channelFilter.value === 'All' || channel === channelFilter.value)
    );
});

// One view for category and A-Z listings: the route's meta says which.
const isAtoZ = computed(() => route.meta.grid === 'atoz');
const letter = computed(() => (route.params.letter ?? 'a').toLowerCase());
const heading = computed(() => (isAtoZ.value ? 'A to Z' : categoryTitle.value || 'Category'));

const hasMore = computed(() => (total.value != null ? items.value.length < total.value : lastPageFull.value));
const lastPageFull = ref(false);

const endpoint = (pageNumber) => {
    const base = isAtoZ.value
        ? `atoz/${encodeURIComponent(letter.value)}`
        : `category/${encodeURIComponent(route.params.id)}`;
    return `${base}?page=${pageNumber}&perPage=${PER_PAGE}`;
};

const fetchPage = async (pageNumber) => {
    loading.value = true;
    error.value = null;
    try {
        const result = await browseFetch(endpoint(pageNumber));
        const known = new Set(items.value.map(({ pid }) => pid));
        items.value.push(...result.items.filter(({ pid }) => !known.has(pid)));
        total.value = result.total;
        lastPageFull.value = result.items.length >= PER_PAGE;
        page.value = pageNumber;
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
};

const loadMore = () => fetchPage(page.value + 1);

// iPlayer's curated rails for this category. Best effort: the grid is the page, rails are a bonus.
const loadRails = async (id) => {
    try {
        const result = await browseFetch(`category/${encodeURIComponent(id)}/rails`);
        if (route.params.id === id) rails.value = result;
    } catch {
        // No rails - the grid still works.
    }
};

const resolveCategoryTitle = async () => {
    try {
        const categories = await browseFetch('categories');
        categoryTitle.value = categories.find(({ id }) => id === route.params.id)?.title ?? route.params.id;
    } catch {
        categoryTitle.value = route.params.id;
    }
};

watch(
    () => route.fullPath,
    () => {
        // Ignore navigation away from this view (the route is changing to something else).
        if (route.meta.grid == null) return;
        items.value = [];
        rails.value = [];
        textFilter.value = '';
        channelFilter.value = 'All';
        total.value = undefined;
        lastPageFull.value = false;
        if (!isAtoZ.value) {
            resolveCategoryTitle();
            loadRails(route.params.id);
        }
        fetchPage(1);
    },
    { immediate: true }
);
</script>

<style lang="less" scoped>
.gridFilters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 0.5rem 0 1rem;

    h2 {
        flex: 1 1 100%;
        margin: 0;
        font-size: 20px;
        font-weight: 400;
    }

    .gridFilter {
        height: 32px;
        padding: 0 10px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
    }
}

.letterBar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 1rem;

    .letter {
        min-width: 32px;
        padding: 5px 8px;
        text-align: center;
        font-size: 14px;
        text-decoration: none;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }

        &.active {
            background-color: @brand-color;
            border-color: @brand-color;
        }
    }
}
</style>
