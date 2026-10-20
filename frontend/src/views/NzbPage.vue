<template>
    <div class="inner-content scroll-x">
        <PageHeader title="Recent Searches" />
        <div class="viewToggleRow">
            <ViewToggle :model-value="viewMode" :modes="['table', 'cards']" @update:model-value="setViewMode" />
        </div>
        <SettingsPageToolbar
            :icons="['delete', 'filterToggle']" delete-label="Clear searches"
            :filters-shown="searchShowFilters" :filters-active="searchFiltersActive"
            @delete-queue-item="clearSearches" @toggle-filters="searchShowFilters = !searchShowFilters"
        >
            <template v-if="searchShowFilters" #filters>
                <input v-model="searchFilterText" class="tableFilter" type="text" placeholder="Filter searches..." />
                <DateRangeFilter v-model="searchDateFrom" v-model:model-value-to="searchDateTo" />
            </template>
        </SettingsPageToolbar>
        <Pagination v-model="searchPage" v-model:page-size="searchPageSize" :total="sortedSearches.length" />
        <div v-if="cardView" class="cardList">
            <DataCard v-for="(entry, index) in pagedSearches" :key="index">
                <template #title>{{ entry.term == '*' ? 'RSS Feed' : entry.term }}</template>
                <template v-if="entry.series != null || entry.episode != null" #subtitle>
                    {{ [entry.series != null ? `Season ${entry.series}` : '', entry.episode != null ? `Episode ${entry.episode}` : ''].filter(Boolean).join(' · ') }}
                </template>
                <template #chips>
                    <span v-if="searchType(entry)" class="pill">{{ searchType(entry) }}</span>
                    <a v-if="entry.hasDetail" class="clickable" @click="showResults(entry)">{{ resultsLabel(entry) }}</a>
                    <span v-else>{{ resultsLabel(entry) }}</span>
                </template>
                <template #foot>
                    <span>{{ [appName(entry.appId), formatDate(entry.time)].filter(Boolean).join(' · ') }}</span>
                </template>
            </DataCard>
            <div v-if="sortedSearches.length == 0" class="empty">No searches recorded yet</div>
        </div>
        <table v-else class="dataTable">
            <colgroup>
                <col style="width: 36ch" />
                <col style="width: 10ch" />
                <col style="width: 10ch" />
                <col style="width: 10ch" />
                <col />
                <col style="width: 10ch" />
                <col style="width: 14ch" />
                <col style="width: 22ch" />
            </colgroup>
            <thead>
                <tr>
                    <th class="sortable" @click="toggleSearchSort('term')">
                        Search term <SortIcon :active="searchSortBy == 'term'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('series')">
                        Season <SortIcon :active="searchSortBy == 'series'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('episode')">
                        Episode <SortIcon :active="searchSortBy == 'episode'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('results')">
                        Results <SortIcon :active="searchSortBy == 'results'" :order="searchSortOrder" />
                    </th>
                    <th></th>
                    <th class="sortable" @click="toggleSearchSort('type')">
                        Type <SortIcon :active="searchSortBy == 'type'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('app')">
                        App <SortIcon :active="searchSortBy == 'app'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('time')">
                        Time <SortIcon :active="searchSortBy == 'time'" :order="searchSortOrder" />
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(entry, index) in pagedSearches" :key="index">
                    <td class="text">{{ entry.term == '*' ? 'RSS Feed' : entry.term }}</td>
                    <td data-title="Season">{{ entry.series ?? '' }}</td>
                    <td data-title="Episode">{{ entry.episode ?? '' }}</td>
                    <td data-title="Results">
                        <a v-if="entry.hasDetail" class="clickable" @click="showResults(entry)">{{ resultsLabel(entry) }}</a>
                        <template v-else>{{ resultsLabel(entry) }}</template>
                    </td>
                    <td></td>
                    <td data-title="Type"><span v-if="searchType(entry)" class="pill">{{ searchType(entry) }}</span></td>
                    <td data-title="App">{{ appName(entry.appId) }}</td>
                    <td data-title="Time">{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="sortedSearches.length == 0">
                    <td colspan="8" class="empty">No searches recorded yet</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="searchPage" v-model:page-size="searchPageSize" :total="sortedSearches.length" />

        <PageHeader title="Recent Grabs" />
        <SettingsPageToolbar
            :icons="['delete', 'filterToggle']" delete-label="Clear grabs"
            :filters-shown="grabShowFilters" :filters-active="grabFiltersActive"
            @delete-queue-item="clearGrabs" @toggle-filters="grabShowFilters = !grabShowFilters"
        >
            <template v-if="grabShowFilters" #filters>
                <input v-model="grabFilterText" class="tableFilter" type="text" placeholder="Filter grabs..." />
                <DateRangeFilter v-model="grabDateFrom" v-model:model-value-to="grabDateTo" />
            </template>
        </SettingsPageToolbar>
        <Pagination v-model="grabPage" v-model:page-size="grabPageSize" :total="sortedGrabs.length" />
        <div v-if="cardView" class="cardList">
            <DataCard v-for="(entry, index) in pagedGrabs" :key="index">
                <template #thumb>
                    <img
                        v-if="getProgrammeThumbnailUrl(entry.pid)"
                        class="clickable"
                        :src="getProgrammeThumbnailUrl(entry.pid)"
                        @click="openInfo(entry.pid)"
                        @error="hideBrokenImage"
                    />
                    <div v-else class="thumbnail-placeholder"></div>
                </template>
                <template #title>
                    <a class="clickable" @click="openInfo(entry.pid)">{{ detailsFor(entry.pid)?.title ?? entry.nzbName }}</a>
                </template>
                <template v-if="detailsFor(entry.pid)?.channel || seriesEpisodeLabel(entry.pid)" #subtitle>
                    {{ [detailsFor(entry.pid)?.channel, seriesEpisodeLabel(entry.pid)].filter(Boolean).join(' · ') }}
                </template>
                <template #chips>
                    <span class="pill">{{ entry.type }}</span>
                </template>
                <template #foot>
                    <span>{{ [appName(entry.appId), formatDate(entry.time)].filter(Boolean).join(' · ') }}</span>
                    <span>{{ entry.pid }}</span>
                </template>
            </DataCard>
            <div v-if="sortedGrabs.length == 0" class="empty">No grabs recorded yet</div>
        </div>
        <table v-else class="dataTable streamsTable">
            <colgroup>
                <col style="width: 70px" />
                <col style="width: 14ch" />
                <col />
                <col style="width: 10ch" />
                <col style="width: 14ch" />
                <col style="width: 22ch" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th class="sortable" @click="toggleGrabSort('pid')">
                        PID <SortIcon :active="grabSortBy == 'pid'" :order="grabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleGrabSort('nzbName')">
                        Name <SortIcon :active="grabSortBy == 'nzbName'" :order="grabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleGrabSort('type')">
                        Type <SortIcon :active="grabSortBy == 'type'" :order="grabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleGrabSort('app')">
                        App <SortIcon :active="grabSortBy == 'app'" :order="grabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleGrabSort('time')">
                        Time <SortIcon :active="grabSortBy == 'time'" :order="grabSortOrder" />
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(entry, index) in pagedGrabs" :key="index">
                    <td>
                        <img
                            v-if="getProgrammeThumbnailUrl(entry.pid)"
                            class="thumbnail clickable"
                            :src="getProgrammeThumbnailUrl(entry.pid)"
                            @click="openInfo(entry.pid)"
                            @error="hideBrokenImage"
                        />
                        <div v-else class="thumbnail-placeholder"></div>
                    </td>
                    <td data-title="PID">{{ entry.pid }}</td>
                    <td class="text">
                        <a class="clickable" @click="openInfo(entry.pid)">
                            {{ detailsFor(entry.pid)?.title ?? entry.nzbName }}
                        </a>
                        <div v-if="detailsFor(entry.pid)?.channel || seriesEpisodeLabel(entry.pid)" class="subtle">
                            {{ [detailsFor(entry.pid)?.channel, seriesEpisodeLabel(entry.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td data-title="Type"><span class="pill">{{ entry.type }}</span></td>
                    <td data-title="App">{{ appName(entry.appId) }}</td>
                    <td data-title="Time">{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="sortedGrabs.length == 0">
                    <td colspan="6" class="empty">No grabs recorded yet</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="grabPage" v-model:page-size="grabPageSize" :total="sortedGrabs.length" />

        <PageHeader title="Failed Grabs" />
        <SettingsPageToolbar
            :icons="['delete', 'filterToggle']" delete-label="Clear failed grabs"
            :filters-shown="failedGrabShowFilters" :filters-active="failedGrabFiltersActive"
            @delete-queue-item="clearFailedGrabs" @toggle-filters="failedGrabShowFilters = !failedGrabShowFilters"
        >
            <template v-if="failedGrabShowFilters" #filters>
                <input v-model="failedGrabFilterText" class="tableFilter" type="text" placeholder="Filter failed grabs..." />
                <DateRangeFilter v-model="failedGrabDateFrom" v-model:model-value-to="failedGrabDateTo" />
            </template>
        </SettingsPageToolbar>
        <Pagination v-model="failedGrabPage" v-model:page-size="failedGrabPageSize" :total="sortedFailedGrabs.length" />
        <div v-if="cardView" class="cardList">
            <DataCard v-for="(entry, index) in pagedFailedGrabs" :key="index">
                <template #title>{{ entry.nzbName }}</template>
                <template #chips>
                    <span class="pill error">Failed</span>
                </template>
                <template v-if="entry.error">{{ entry.error }}</template>
                <template #foot>
                    <span>{{ [appName(entry.appId), formatDate(entry.time)].filter(Boolean).join(' · ') }}</span>
                    <span>{{ entry.pid }}</span>
                </template>
            </DataCard>
            <div v-if="sortedFailedGrabs.length == 0" class="empty">No failed grabs</div>
        </div>
        <table v-else class="dataTable">
            <colgroup>
                <col style="width: 14ch" />
                <col />
                <col style="width: 38ch" />
                <col style="width: 14ch" />
                <col style="width: 22ch" />
            </colgroup>
            <thead>
                <tr>
                    <th class="sortable" @click="toggleFailedGrabSort('pid')">
                        PID <SortIcon :active="failedGrabSortBy == 'pid'" :order="failedGrabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleFailedGrabSort('nzbName')">
                        Name <SortIcon :active="failedGrabSortBy == 'nzbName'" :order="failedGrabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleFailedGrabSort('error')">
                        Error <SortIcon :active="failedGrabSortBy == 'error'" :order="failedGrabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleFailedGrabSort('app')">
                        App <SortIcon :active="failedGrabSortBy == 'app'" :order="failedGrabSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleFailedGrabSort('time')">
                        Time <SortIcon :active="failedGrabSortBy == 'time'" :order="failedGrabSortOrder" />
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(entry, index) in pagedFailedGrabs" :key="index">
                    <td data-title="PID">{{ entry.pid }}</td>
                    <td class="text">{{ entry.nzbName }}</td>
                    <td class="text">{{ entry.error }}</td>
                    <td data-title="App">{{ appName(entry.appId) }}</td>
                    <td data-title="Time">{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="sortedFailedGrabs.length == 0">
                    <td colspan="5" class="empty">No failed grabs</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="failedGrabPage" v-model:page-size="failedGrabPageSize" :total="sortedFailedGrabs.length" />
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import DataCard from '@/components/common/DataCard.vue';
import DateRangeFilter from '@/components/common/DateRangeFilter.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortIcon from '@/components/common/SortIcon.vue';
import Pagination from '@/components/common/TablePagination.vue';
import ViewToggle from '@/components/common/ViewToggle.vue';
import SearchResultsDialog from '@/components/modals/SearchResultsDialog.vue';
import VideoInfoModal from '@/components/modals/VideoInfoModal.vue';
import { details, loadDetails, prefetchThumbnails } from '@/lib/detailsCache';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { useViewMode } from '@/lib/useViewMode';
import {
    formatDateTimeWithMillis, getProgrammeThumbnailUrl, getSeriesEpisodeLabel, hideBrokenImage,
} from '@/lib/utils';

// Cards on phones (dense tables), tables on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.nzbViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');

const searchHistory = ref([]);
const grabHistory = ref([]);
const failedGrabHistory = ref([]);
const apps = ref([]);


const socket = inject('socket');

function detailsFor(pid) {
    return details[pid];
}

function seriesEpisodeLabel(pid) {
    return getSeriesEpisodeLabel(detailsFor(pid));
}

function loadMissingDetails() {
    // Only what is on screen - the history can run to hundreds of rows but one page is shown at a time.
    [...new Set(pagedGrabs.value.map(({ pid }) => pid))].filter(Boolean).forEach(loadDetails);
}

// Once the visible page is requested, quietly warm the next few pages of thumbnails in the
// background, so paging doesn't wait on BBC. Capped: the history holds hundreds of grabs and
// warming them all would keep the browser's connections busy for no benefit.
const PREFETCH_PAGES = 3;

function prefetchRest() {
    prefetchThumbnails(sortedGrabs.value.map(({ pid }) => pid), grabPageSize.value * PREFETCH_PAGES);
}

function openInfo(pid) {
    const infoModal = useModal({
        component: VideoInfoModal,
        attrs: { pid },
    });
    infoModal.open();
}

function appName(appId) {
    if (!appId) return '';
    return apps.value.find(({ id }) => id == appId)?.name ?? '';
}

// Searches don't record a type of their own: it is the type the results share (none when they are
// mixed or unknown), or TV when the search named a season/episode.
function searchType(entry) {
    if (entry.type) return entry.type;
    if (entry.series != null || entry.episode != null) return 'TV';
    return '';
}

const {
    filterText: searchFilterText, sortBy: searchSortBy, sortOrder: searchSortOrder,
    dateFrom: searchDateFrom, dateTo: searchDateTo, sorted: sortedSearches, toggleSort: toggleSearchSort,
} = useSortFilter(searchHistory, {
    filterFn: (entry, query) => [
        entry.term == '*' ? 'RSS Feed' : entry.term,
        searchType(entry),
        appName(entry.appId),
    ].some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        term: (entry) => (entry.term == '*' ? 'RSS Feed' : entry.term ?? ''),
        results: (entry) => entry.results,
        series: (entry) => entry.series,
        episode: (entry) => entry.episode,
        type: (entry) => searchType(entry),
        app: (entry) => appName(entry.appId),
        time: (entry) => entry.time,
    },
    dateAccessor: (entry) => entry.time,
    storageKey: 'nzbSearchTable',
});

const searchFiltersActive = computed(() => !!(searchFilterText.value || searchDateFrom.value || searchDateTo.value));
const searchShowFilters = ref(searchFiltersActive.value);

const {
    filterText: grabFilterText, sortBy: grabSortBy, sortOrder: grabSortOrder,
    dateFrom: grabDateFrom, dateTo: grabDateTo, sorted: sortedGrabs, toggleSort: toggleGrabSort,
} = useSortFilter(grabHistory, {
    filterFn: (entry, query) => [entry.pid, entry.nzbName, entry.type, appName(entry.appId)]
        .some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        pid: (entry) => entry.pid,
        nzbName: (entry) => entry.nzbName,
        type: (entry) => entry.type,
        app: (entry) => appName(entry.appId),
        time: (entry) => entry.time,
    },
    dateAccessor: (entry) => entry.time,
    storageKey: 'nzbGrabTable',
});

const grabFiltersActive = computed(() => !!(grabFilterText.value || grabDateFrom.value || grabDateTo.value));
const grabShowFilters = ref(grabFiltersActive.value);

const {
    filterText: failedGrabFilterText, sortBy: failedGrabSortBy, sortOrder: failedGrabSortOrder,
    dateFrom: failedGrabDateFrom, dateTo: failedGrabDateTo, sorted: sortedFailedGrabs, toggleSort: toggleFailedGrabSort,
} = useSortFilter(failedGrabHistory, {
    filterFn: (entry, query) => [entry.pid, entry.nzbName, entry.error, appName(entry.appId)]
        .some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        pid: (entry) => entry.pid,
        nzbName: (entry) => entry.nzbName,
        error: (entry) => entry.error,
        app: (entry) => appName(entry.appId),
        time: (entry) => entry.time,
    },
    dateAccessor: (entry) => entry.time,
    storageKey: 'nzbFailedGrabTable',
});

const failedGrabFiltersActive = computed(() => !!(failedGrabFilterText.value || failedGrabDateFrom.value || failedGrabDateTo.value));
const failedGrabShowFilters = ref(failedGrabFiltersActive.value);

const {
    page: searchPage, pageSize: searchPageSize, pagedItems: pagedSearches,
} = usePagination(sortedSearches);
const {
    page: grabPage, pageSize: grabPageSize, pagedItems: pagedGrabs,
} = usePagination(sortedGrabs);

watch(pagedGrabs, loadMissingDetails);
watch(grabHistory, prefetchRest);
const {
    page: failedGrabPage, pageSize: failedGrabPageSize, pagedItems: pagedFailedGrabs,
} = usePagination(sortedFailedGrabs);

onMounted(async () => {
    await refresh();

    socket.value?.on('searchHistory', (data) => {
        searchHistory.value = data.filter(({ term }) => term != '*');
    });
    socket.value?.on('grabHistory', (data) => {
        grabHistory.value = data;
    });
    socket.value?.on('failedGrabHistory', (data) => {
        failedGrabHistory.value = data;
    });
});

onBeforeUnmount(() => {
    socket.value?.off('searchHistory');
    socket.value?.off('grabHistory');
    socket.value?.off('failedGrabHistory');
});

async function refresh() {
    const [searches, grabs, failedGrabs, appList] = await Promise.all([
        ipFetch('json-api/stats/searchHistory?filterRss=true&summary=true'),
        ipFetch('json-api/stats/grabHistory'),
        ipFetch('json-api/stats/failedGrabHistory'),
        ipFetch('json-api/apps'),
    ]);
    searchHistory.value = searches.data;
    grabHistory.value = grabs.data;
    failedGrabHistory.value = failedGrabs.data;
    apps.value = appList.data;
}

// Returned results out of everything the search found, e.g. 45/60 (60+ when the list was capped).
function resultsLabel(entry) {
    if (!entry.filteredOut) return entry.results;
    return `${entry.results}/${entry.results + entry.filteredOut}${entry.truncated ? '+' : ''}`;
}

function formatDate(time) {
    if (!time) return '';
    return formatDateTimeWithMillis(time);
}

async function showResults(entry) {
    const { items, trace } = (await ipFetch(`json-api/stats/searchHistory/detail?term=${encodeURIComponent(entry.term)}&time=${entry.time}`)).data;
    const resultsModal = useModal({
        component: SearchResultsDialog,
        attrs: {
            term: entry.term,
            items,
            trace,
        },
    });
    resultsModal.open();
}

const clearFailedGrabs = async () => {
    if (await dialogService.confirm('Clear Failed Grabs', 'Are you sure you want to clear the failed grabs log?')) {
        await ipFetch('json-api/stats/failedGrabHistory', 'DELETE');
        failedGrabHistory.value = [];
        failedGrabPage.value = 1;
    }
};

const clearSearches = async () => {
    if (await dialogService.confirm('Clear Recent Searches', 'Are you sure you want to clear the recent searches log?')) {
        await ipFetch('json-api/stats/searchHistory', 'DELETE');
        searchHistory.value = [];
        searchPage.value = 1;
    }
};

const clearGrabs = async () => {
    if (await dialogService.confirm('Clear Recent Grabs', 'Are you sure you want to clear the recent grabs log?')) {
        await ipFetch('json-api/stats/grabHistory', 'DELETE');
        grabHistory.value = [];
        grabPage.value = 1;
    }
};
</script>
