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
        <TablePagination v-model="gridPage" v-model:page-size="gridPageSize" :total="filteredItems.length" />
        <div v-if="pagedItems.length" class="browseGrid">
            <ProgrammeCard v-for="item in pagedItems" :key="item.pid" :item="item" />
        </div>
        <p v-else-if="items.length && !loadingAll">Nothing matches that filter.</p>
        <LoadingIndicator v-if="loading" />
        <p v-else-if="!error && items.length === 0">No programmes found.</p>
        <p v-else-if="loadingAll" class="loadingMoreNote">Loading more ({{ items.length }} of {{ total ?? '…' }})&hellip;</p>
        <TablePagination v-model="gridPage" v-model:page-size="gridPageSize" :total="filteredItems.length" />
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { browseFetch } from '@/lib/browse';
import { usePagination } from '@/lib/usePagination';

const PER_PAGE = 150; // the server's max perPage - fewest round trips when fetching everything
const letters = ['0', ...'abcdefghijklmnopqrstuvwxyz'];

const route = useRoute();
const items = ref([]);
const total = ref(undefined);
const loading = ref(false); // first page only - the grid is blank until this resolves
const loadingAll = ref(false); // remaining pages, fetched automatically in the background
const error = ref(null);
const categoryTitle = ref('');
const rails = ref([]);
const textFilter = ref('');
const channelFilter = ref('All');

// Everything is fetched up front (in the background, page by page) so filtering and pagination
// below apply to the whole listing, not just whatever page happened to be loaded so far.
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

const {
    page: gridPage, pageSize: gridPageSize, pagedItems,
} = usePagination(filteredItems);

watch([textFilter, channelFilter], () => {
    gridPage.value = 1;
});

// One view for category and A-Z listings: the route's meta says which.
const isAtoZ = computed(() => route.meta.grid === 'atoz');
const letter = computed(() => (route.params.letter || '0').toLowerCase());
const heading = computed(() => (isAtoZ.value ? 'A to Z' : categoryTitle.value || 'Category'));

const endpoint = (pageNumber) => {
    const base = isAtoZ.value
        ? `atoz/${encodeURIComponent(letter.value)}`
        : `category/${encodeURIComponent(route.params.id)}`;
    return `${base}?page=${pageNumber}&perPage=${PER_PAGE}`;
};

// Fetches every page of the listing automatically, one at a time, stopping once we've seen
// `total` items (or a short page, if the server never reports a total).
const fetchAll = async () => {
    loading.value = true;
    loadingAll.value = true;
    error.value = null;
    const requestLetter = letter.value;
    const requestCategoryId = route.params.id;
    const stillCurrent = () =>
        isAtoZ.value ? letter.value === requestLetter : route.params.id === requestCategoryId;
    try {
        let pageNumber = 1;
        let lastPageSize = PER_PAGE;
        while (stillCurrent() && (total.value == null || items.value.length < total.value) && lastPageSize >= PER_PAGE) {
            const result = await browseFetch(endpoint(pageNumber));
            if (!stillCurrent()) return;
            const known = new Set(items.value.map(({ pid }) => pid));
            items.value.push(...result.items.filter(({ pid }) => !known.has(pid)));
            total.value = result.total;
            lastPageSize = result.items.length;
            loading.value = false;
            pageNumber += 1;
        }
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
        loadingAll.value = false;
    }
};

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
        gridPage.value = 1;
        if (!isAtoZ.value) {
            resolveCategoryTitle();
            loadRails(route.params.id);
        }
        fetchAll();
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

.loadingMoreNote {
    color: @subtle-text-color;
    font-size: 13px;
    text-align: center;
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
