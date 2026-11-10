<template>
    <div class="inner-content searchTop">
        <PageHeader title="Search" icon="search" />
        <SettingsPageToolbar
            :icons="toolbarIcons"
            :view-mode="viewMode" :view-modes="['table', 'posters']" @update:view-mode="setViewMode"
            @download="multipleImmediateDownload"
        >
            <template #actions>
                <button
                    v-if="viewMode === 'posters'"
                    type="button"
                    :class="{ enabled: smallIcons }"
                    :aria-pressed="smallIcons"
                    :title="smallIcons ? 'Showing small TV / film / series icons on posters' : 'Show small TV / film / series icons on posters'"
                    aria-label="Small icons on posters"
                    @click="toggleSmallIcons"
                >
                    <font-awesome-icon :icon="['fas', 'icons']" />
                </button>
                <button
                    v-if="viewMode === 'posters' && searchResults.length"
                    type="button"
                    :class="{ enabled: selectMode }"
                    :title="selectMode ? 'Done selecting' : 'Select results to download'"
                    :aria-label="selectMode ? 'Done selecting' : 'Select results to download'"
                    @click="toggleSelectMode"
                >
                    <font-awesome-icon :icon="['fas', selectMode ? 'square-check' : 'list-check']" />
                </button>
            </template>
        </SettingsPageToolbar>
    </div>
    <div class="pageSearchBar">
        <div class="searchPanel">
            <font-awesome-icon class="searchIcon" :icon="['fas', 'magnifying-glass']" />
            <input
                ref="searchEl" v-model="searchInput" class="searchBox" type="text"
                placeholder="Search programmes" autocomplete="off" enterkeyhint="search"
                role="combobox" aria-label="Search programmes" aria-autocomplete="list" aria-controls="searchSuggestions"
                :aria-expanded="showSuggestions"
                :aria-activedescendant="activeIndex >= 0 ? `searchSuggestion-${activeIndex}` : undefined"
                @input="onInput" @focus="onInput" @blur="closeSuggestions"
                @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)"
                @keydown.esc="closeSuggestions" @keyup.enter="onEnter" />
            <button v-if="searchInput" type="button" class="clearSearch" title="Clear" aria-label="Clear" @mousedown.prevent="clearInput">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
            <ul v-if="showSuggestions" id="searchSuggestions" class="suggestions" role="listbox">
                <li
                    v-for="(suggestion, index) in suggestions" :id="`searchSuggestion-${index}`" :key="suggestionKey(suggestion)"
                    role="option" :aria-selected="index === activeIndex" :class="{ active: index === activeIndex }" :title="suggestionLabel(suggestion)" @mousedown.prevent="openSuggestion(suggestion)"
                >
                    <font-awesome-icon :icon="['fas', suggestionIcon(suggestion)]" fixed-width />
                    <span>{{ suggestion.title }}</span>
                </li>
                <li v-if="!suggestions.length" class="noMatches" role="option" aria-disabled="true" aria-selected="false">No matching titles</li>
                <li class="seeAll" role="option" aria-selected="false" @mousedown.prevent="runSearch">See all results for "{{ searchInput }}"</li>
            </ul>
        </div>
    </div>
    <div v-if="!loading" class="inner-content scroll-x">
        <div v-if="searchResults.length" class="resultsToolbar">
            <span class="resultCount">
                {{ filteredResults.length }} result{{ filteredResults.length === 1 ? '' : 's' }}
                <template v-if="searchTerm">for &ldquo;<span class="termText" :title="searchTerm">{{ searchTerm }}</span>&rdquo;</template>
                <span v-if="loadingMore" class="loadingMoreNote">
                    <font-awesome-icon :icon="['fas', 'circle-notch']" spin /> more arriving
                </span>
            </span>
        </div>
        <div v-if="typeOptions.length > 2 || channelOptions.length > 2 || versionOptions.length > 1" class="channelChips" role="group" aria-label="Filter results">
            <template v-if="typeOptions.length > 2">
                <FilterChip v-for="option in typeOptions" :key="`type-${option}`" :active="filter === option" @click="selectFilter(option)">
                    {{ option === 'All' ? 'All types' : option }}
                </FilterChip>
                <span v-if="channelOptions.length > 2 || versionOptions.length > 1" class="chipDivider" aria-hidden="true"></span>
            </template>
            <template v-if="versionOptions.length > 1">
                <FilterChip v-for="option in versionOptions" :key="`version-${option.key}`" :active="versionFilter === option.key" @click="pickVersion(option.key)">
                    <font-awesome-icon v-if="option.icon" :icon="['fas', option.icon]" /> {{ option.label }}
                </FilterChip>
                <span v-if="channelOptions.length > 2" class="chipDivider" aria-hidden="true"></span>
            </template>
            <template v-if="channelOptions.length > 2">
                <select class="gridFilter" aria-label="Channel" :value="channelFilter" @change="pickChannel($event.target.value)">
                    <option v-for="option in channelOptions" :key="option" :value="option">
                        {{ option === 'All' ? 'All channels' : option }}
                    </option>
                </select>
            </template>
        </div>
        <TablePagination v-model="resultsPage" v-model:page-size="resultsPageSize" :total="filteredResults.length" />
        <div v-if="selectMode && viewMode === 'posters' && searchResults.length" class="selectBar">
            <span>{{ selectedCount }} of {{ downloadableResults.length }} selected</span>
            <button type="button" :title="`Select all ${downloadableResults.length} results`" :aria-label="`Select all ${downloadableResults.length} results`" @click="setAllChecked(true)">
                <font-awesome-icon :icon="['fas', 'check-double']" />
            </button>
            <button type="button" title="Clear selection" aria-label="Clear selection" :disabled="!selectedCount" @click="setAllChecked(false)">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
        </div>
        <div v-if="viewMode === 'posters' && filteredResults.length" class="browseGrid">
            <template v-for="item in posterItems" :key="item.pid">
                <CollectionCard v-if="item.result.kind === 'collection'" :collection="item.result" @click="openCollection(item.result)" />
                <ProgrammeCard
                    v-else :item="item"
                    :selectable="selectMode" :selected="!!item.result.checked" :icon-badges="smallIcons"
                    @toggle="item.result.checked = !item.result.checked"
                />
            </template>
        </div>
        <table v-else-if="filteredResults.length" class="resultsTable responsive-table">
            <colgroup>
                <col style="width: 40px" />
                <col style="width: 110px" />
                <col />
                <col style="width: 100px" />
                <col style="width: 150px" />
                <col style="width: 90px" />
                <col style="width: 100px" />
                <col style="width: 190px" />
                <col style="width: 44px" />
                <col style="width: 44px" />
            </colgroup>
            <thead>
                <tr>
                    <th>
                        <CheckInput v-model="allChecked" />
                    </th>
                    <th>Type</th>
                    <th>Title</th>
                    <th>Series</th>
                    <th>Episode</th>
                    <th>Est. Size</th>
                    <th>Channel</th>
                    <th>First Broadcast</th>
                    <th>
                        <font-awesome-icon :icon="['fas', 'gears']" />
                    </th>
                    <th />
                </tr>
            </thead>
            <tbody>
                <template v-for="result of pagedResults" :key="result.pid">
                <tr v-if="result.kind === 'collection'" class="clickable" @click="openCollection(result)">
                    <td />
                    <td data-title="Type"><span class="pill">{{ result.type }}</span></td>
                    <td class="text" :title="result.synopsis">{{ result.title }}</td>
                    <td data-title="Series">-</td>
                    <td data-title="Episode">{{ result.count }} {{ result.count === 1 ? 'title' : 'titles' }}</td>
                    <td data-title="Est. Size">-</td>
                    <td data-title="Channel" />
                    <td data-title="First Broadcast">-</td>
                    <td />
                    <td />
                </tr>
                <tr v-else class="clickable">
                    <td>
                        <CheckInput v-model="result.checked" />
                    </td>
                    <td data-title="Type" @click="download(result)">
                        <span :class="['pill', result.type]">
                            {{ result.type }}
                        </span>
                    </td>
                    <td class="text" @click="download(result)">
                        {{ result.title }}
                        <QualityBadges :item="result" class="titleBadges" />
                        <div class="filename">{{ result.nzbName }}</div>
                    </td>
                    <td
                        data-title="Series"
                        :title="result.seriesPid ? 'View Series' : undefined"
                        @click="result.seriesPid ? router.push({ path: `${result.audioOnly ? '/browse/radio' : '/browse/programme'}/${result.seriesPid}`, query: { episode: result.pid } }) : download(result)"
                    >
                        {{ result.series ? `Series ${result.series}` : '-' }}
                    </td>
                    <td data-title="Episode" @click="download(result)">
                        {{ result.episode ? `Episode ${result.episode}` : result.episodeTitle }}
                    </td>
                    <td data-title="Est. Size" @click="download(result)">
                        {{ formatStorageSize(result.size) }}
                    </td>
                    <td data-title="Channel" @click="download(result)">
                        <ChannelPill :channel="result.channel" />
                    </td>
                    <td data-title="First Broadcast" @click="download(result)">
                        {{ formatDate(result.pubDate) }}
                    </td>
                    <td @click="immediateDownload(result)">
                        <button type="button" class="rowIconButton" title="Download" aria-label="Download">
                            <font-awesome-icon
                                :class="['clickable', result.downloading ? 'downloading' : '']"
                                :icon="['fas', 'cloud-arrow-down']"
                            />
                        </button>
                    </td>
                    <td>
                        <font-awesome-icon
                            class="clickable"
                            :icon="['fas', 'play']"
                            :title="result.radio ? 'Play audio' : 'Play Video'"
                            @click="preview(result)"
                        />
                    </td>
                </tr>
                </template>
            </tbody>
        </table>
        <TablePagination v-model="resultsPage" v-model:page-size="resultsPageSize" :total="filteredResults.length" />
        <div v-if="filteredResults.length == 0 && !loadingMore && searchTerm" class="emptyState">
            <font-awesome-icon class="emptyIcon" :icon="['fas', 'magnifying-glass']" />
            <div class="emptyTitle">
                <template v-if="searchResults.length">Nothing matches that filter</template>
                <template v-else>No results for “<span class="termText" :title="searchTerm">{{ searchTerm }}</span>”</template>
            </div>
            <div v-if="!searchResults.length" class="emptyHint">Try fewer words, or one of your recent searches below.</div>
        </div>
        <p v-if="searchSettingsLine && (searchTerm || showHome)" class="searchSettingsNote">
            <font-awesome-icon :icon="['fas', 'sliders']" />
            <span>{{ searchSettingsLine }}</span>
            <router-link :to="{ path: '/settings', hash: '#search' }">Change in Settings</router-link>
        </p>
        <div v-if="showHome" class="searchHome">
            <section v-if="recent.length">
                <h2>Recent searches</h2>
                <div class="chipRow">
                    <FilterChip v-for="term in recent" :key="term" :remove-label="`Remove ${term} from recent searches`" @click="searchFor(term)" @remove="removeRecent(term)">
                        <font-awesome-icon :icon="['fas', 'clock-rotate-left']" /><span class="termText" :title="term">{{ term }}</span>
                    </FilterChip>
                </div>
            </section>
        </div>
    </div>
    <LoadingIndicator v-if="loading" />
</template>

<script setup>
import { computed, inject, onActivated, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRoute, useRouter } from 'vue-router';

import CollectionCard from '@/components/browse/CollectionCard.vue';
import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import ChannelPill from '@/components/common/ChannelPill.vue';
import FilterChip from '@/components/common/FilterChip.vue';
import CheckInput from '@/components/common/form/CheckInput.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import QualityBadges from '@/components/common/QualityBadges.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { browseFetch } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { defaultMediaMode, estimateSizeMb } from '@/lib/downloadSummary';
import { askAboutVersions, batchVersionKey, initialVersionKey, offeredVersions, planDownloads, quickVersion } from '@/lib/downloadVersions';
import { ipFetch } from '@/lib/ipFetch';
import { radioEpisodeOf } from '@/lib/mediaDisplay';
import { radioActive } from '@/lib/mediaMode';
import { playInPip } from '@/lib/pipPlayer';
import { playProgramme } from '@/lib/playVersion';
import { useRadioActions } from '@/lib/radio';
import { askRadioDownload } from '@/lib/radioDownloadChoice';
import { streamSearch } from '@/lib/searchStream';
import { suggestionIcon, suggestionKey, suggestionLabel, suggestionPath } from '@/lib/suggestions';
import toastService from '@/lib/toastService';
import { usePagination } from '@/lib/usePagination';
import { useSearchSuggestions } from '@/lib/useSearchSuggestions';
import { useViewMode } from '@/lib/useViewMode';
import { buildDownloadQuery, formatDate, formatStorageSize } from '@/lib/utils';

const route = useRoute();
const router = useRouter();

const globalSettings = inject('globalSettings', ref({}));
const searchEl = ref(null);
const selectMode = ref(false);
const searchResults = ref([]);
const searchTerm = ref('');
const searchInput = ref(route.query.searchTerm ?? '');
const loading = ref(searchTerm.value !== '');
const loadingMore = ref(false); // results still arriving after the first batch has been shown
const filter = ref('All');
const allChecked = ref(false);

// How manual search is set up right now, so a surprising result can be traced to a setting.
const manualSettings = ref(undefined);
const loadManualSettings = async () => {
    try {
        const { ok, data } = await ipFetch('json-api/search/settings');
        manualSettings.value = ok ? data : undefined;
    } catch {
        manualSettings.value = undefined;
    }
};
const searchSettingsLine = computed(() => {
    const settings = manualSettings.value;
    // These describe the iPlayer search; radio asks BBC Sounds, so they don't apply.
    if (!settings || radioActive()) return '';
    const parts = [settings.native ? `Native ${settings.engine === 'V2' ? '2.0' : '1.0'}` : 'get_iplayer search'];
    if (settings.native) {
        parts.push(settings.matchAllWords ? 'all words' : 'any word');
        if (settings.expandCollections) parts.push('collections by pid or link');
        if (settings.collectionNames) parts.push('collections by name');
    }
    return `Search: ${parts.join(' · ')}`;
});

const toolbarIcons = computed(() => {
    const icons = [];
    // The table has its own checkboxes; in the poster view the button needs a selection to act on.
    if (viewMode.value === 'posters' ? selectedCount.value > 0 : downloadableResults.value.length) icons.push('download');
    return icons;
});

// As-you-type suggestions under the search box (the logic is shared with the nav bar).
const {
    suggestions, showSuggestions, activeIndex, closeSuggestions, onInput: suggestInput, moveActive, openSuggestion, onEnter,
} = useSearchSuggestions({
    term: searchInput,
    open: (suggestion) => {
        searchInput.value = '';
        router.push(suggestionPath(suggestion));
    },
    search: () => runSearch(),
});

const onInput = () => {
    // An emptied box puts the page back to how it opens blank.
    if (!searchInput.value && (searchTerm.value || route.query.searchTerm)) resetSearch();
    suggestInput();
};

// A collection is a result you open, not download from here: it is left out of selecting and downloading.
const isCollection = (result) => result.kind === 'collection';
const collectionResult = (collection) => ({ ...collection, pid: collection.id, kind: 'collection', type: 'COLLECTION' });
const openCollection = ({ id }) => router.push({ path: '/browse/collections', query: { c: id } });
const downloadableResults = computed(() => filteredResults.value.filter((result) => !isCollection(result)));

const selectedCount = computed(() => searchResults.value.filter((result) => result.checked).length);

const setAllChecked = (value) => {
    downloadableResults.value.forEach((result) => {
        result.checked = value;
    });
    allChecked.value = value;
};

const toggleSelectMode = () => {
    if (selectMode.value) setAllChecked(false);
    selectMode.value = !selectMode.value;
};

const clearInput = () => {
    searchInput.value = '';
    resetSearch();
    closeSuggestions();
    searchEl.value?.focus();
};

// Back to the blank page: drop the results and the term, and take it out of the URL.
const resetSearch = () => {
    searchAbort?.abort();
    searchAbort = null;
    rememberSearch('');
    selectMode.value = false;
    searchResults.value = [];
    searchTerm.value = '';
    filter.value = 'All';
    channelFilter.value = 'All';
    versionFilter.value = 'All';
    loading.value = false;
    loadingMore.value = false;
    if (route.query.searchTerm) router.replace({ name: 'search' });
};

const searchFor = (term) => {
    searchInput.value = term;
    runSearch();
};

const pickChannel = (option) => {
    channelFilter.value = option;
    resultsPage.value = 1;
};

// An empty page offers somewhere to go: the viewer's own recent searches. The same chips come back under a
// search that found nothing.
const recent = ref([]);
const showHome = computed(() => !loading.value && (!searchTerm.value || (searchResults.value.length === 0 && !loadingMore.value)));

// Up to 8 distinct terms are shown; the rest of the fetched history backfills a removed chip.
const RECENT_SHOWN = 8;
const recentPool = ref([]);

onMounted(async () => {
    if (!searchInput.value) searchEl.value?.focus();
    // The blank page shows how searching is set up, above the recent searches.
    loadManualSettings();
    try {
        const { ok, data } = await ipFetch('json-api/stats/searchHistory?limit=80&filterRss=true');
        if (ok && Array.isArray(data)) {
            const seen = new Set();
            // Searches typed here have no app behind them (Sonarr/Radarr ones do); newest first, each term once.
            recentPool.value = data
                .filter(({ term, appId }) => term && term !== '*' && !appId)
                .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
                .map(({ term }) => term.trim())
                .filter((term) => term && !seen.has(term.toLowerCase()) && seen.add(term.toLowerCase()));
            recent.value = recentPool.value.slice(0, RECENT_SHOWN);
        }
    } catch {
        // Recent searches are a nicety.
    }
});

const removeRecent = async (term) => {
    const before = recentPool.value;
    recentPool.value = before.filter((t) => t !== term);
    recent.value = recentPool.value.slice(0, RECENT_SHOWN);
    try {
        const { ok } = await ipFetch(`json-api/stats/searchHistory/term?term=${encodeURIComponent(term)}`, 'DELETE');
        if (!ok) throw new Error('delete failed');
    } catch {
        recentPool.value = before;
        recent.value = before.slice(0, RECENT_SHOWN);
        toastService.error('Unable to remove that search');
    }
};

const runSearch = () => {
    closeSuggestions();
    filter.value = 'All';
    channelFilter.value = 'All';
    versionFilter.value = 'All';
    if (!searchInput.value.trim()) rememberSearch('');
    router.push({ name: 'search', query: { searchTerm: searchInput.value } });
};

// Only offered when the results really mix TV and movies.
const typeOptions = computed(() => [
    'All',
    ...['TV', 'Movie', 'Collection'].filter((type) => searchResults.value.some((result) => result.type === type.toUpperCase())),
]);

const channelFilter = ref('All');
const channelOptions = computed(() => [
    'All',
    ...[...new Set(searchResults.value.map(({ channel }) => channel).filter(Boolean))].sort(),
]);

// Only the versions some result actually has are offered.
const versionLabels = [
    { key: 'audio-described', label: 'Audio described', icon: 'audio-description' },
    { key: 'signed', label: 'Signed', icon: 'sign-language' },
];
const versionFilter = ref('All');
const versionOptions = computed(() => [
    { key: 'All', label: 'All versions' },
    ...versionLabels.filter(({ key }) => searchResults.value.some((result) => result.versions?.includes(key))),
]);
const pickVersion = (key) => {
    versionFilter.value = key;
    resultsPage.value = 1;
};

const filteredResults = computed(() => {
    return searchResults.value.filter(
        ({ type, channel, versions }) =>
            (filter.value == 'All' || type == filter.value.toUpperCase()) &&
            (channelFilter.value == 'All' || channel == channelFilter.value) &&
            (versionFilter.value == 'All' || versions?.includes(versionFilter.value))
    );
});

const {
    page: resultsPage, pageSize: resultsPageSize, pagedItems: pagedResults,
} = usePagination(filteredResults);

// Posters on phones (the table collapses into long stacks of cramped cards there), the table on
// desktop; the user's own choice is remembered per browser.
const { viewMode, setViewMode } = useViewMode('iplayarr.searchViewMode', {
    modes: ['table', 'posters'],
    desktop: 'table',
    mobile: 'posters',
});

// Search results only carry pids, so artwork for the posters is fetched per visible page
// (server-side metadata is cached) and merged in as it arrives.
const DETAILS_CHUNK = 40; // BrowseRoute's MAX_DETAIL_PIDS
const thumbnails = ref({});
const requestedThumbnails = new Set();
watch(
    [pagedResults, viewMode],
    async ([results, mode]) => {
        if (mode !== 'posters') return;
        const missing = results.filter((result) => !isCollection(result) && !result.thumbnail).map(({ pid }) => pid).filter((pid) => !requestedThumbnails.has(pid));
        if (missing.length === 0) return;
        missing.forEach((pid) => requestedThumbnails.add(pid));
        // The server takes at most 40 pids per lookup, and with a big page (Items Before Paging) or a page restored
        // on Back they all arrive at once, so ask in chunks.
        const chunks = [];
        for (let i = 0; i < missing.length; i += DETAILS_CHUNK) chunks.push(missing.slice(i, i + DETAILS_CHUNK));
        await Promise.all(
            chunks.map(async (chunk) => {
                try {
                    const details = await browseFetch(`details?pids=${chunk.join(',')}`);
                    const found = {};
                    details.forEach(({ pid, thumbnail }) => {
                        if (thumbnail) found[pid] = thumbnail;
                    });
                    thumbnails.value = { ...thumbnails.value, ...found };
                } catch {
                    // Posters just fall back to the placeholder tile (and are asked for again next time).
                    chunk.forEach((pid) => requestedThumbnails.delete(pid));
                }
            })
        );
    },
    { immediate: true }
);

// Small TV / film icons on the poster thumbnails, remembered per browser (storage may be unavailable).
const SMALL_ICONS_KEY = 'iplayarr.searchSmallIcons';
const readSmallIcons = () => {
    try {
        return localStorage.getItem(SMALL_ICONS_KEY) === 'true';
    } catch {
        return false;
    }
};
const smallIcons = ref(readSmallIcons());
const toggleSmallIcons = () => {
    smallIcons.value = !smallIcons.value;
    try {
        localStorage.setItem(SMALL_ICONS_KEY, String(smallIcons.value));
    } catch {
        // Not persisted - the toggle still works for this session.
    }
};

const posterItems = computed(() =>
    pagedResults.value.map((result) => ({
        pid: result.pid,
        seriesPid: result.seriesPid,
        kind: result.kind ?? 'episode',
        radio: result.radio,
        showId: result.showId,
        type: result.type,
        title: result.title,
        subtitle: result.episode ? `Series ${result.series}, Episode ${result.episode}` : result.episodeTitle,
        episodeTitle: result.episodeTitle,
        series: result.series,
        episode: result.episode,
        channel: result.channel,
        audioOnly: result.audioOnly,
        pubDate: result.pubDate,
        nzbName: result.nzbName,
        versions: result.versions,
        thumbnail: result.thumbnail ?? thumbnails.value[result.pid],
        result,
    }))
);

// Results stream in: the table appears with the first batch while the rest keep arriving behind it.
// A new search aborts the previous stream so its late batches can't land in the new results.
let searchAbort = null;

// Coming back to Search from another menu item (no term in the URL) reopens the last search of this tab; clearing the
// box forgets it. Per tab (sessionStorage), and storage may be unavailable.
const LAST_SEARCH_KEY = 'iplayarr.lastSearchTerm';
const rememberSearch = (term) => {
    try {
        if (term) sessionStorage.setItem(LAST_SEARCH_KEY, term);
        else sessionStorage.removeItem(LAST_SEARCH_KEY);
    } catch {
        // Not remembered.
    }
};
const restoreLastSearch = () => {
    // The kept-alive page is rebuilt behind the scenes when the Video | Radio mode changes (see modeRoute); that must not
    // pull you back to the search from another page.
    if (route.name !== 'search') return;
    if (route.query.searchTerm) return;
    let last = null;
    try {
        last = sessionStorage.getItem(LAST_SEARCH_KEY);
    } catch {
        // Nothing to restore.
    }
    if (last) router.replace({ name: 'search', query: { searchTerm: last } });
};
restoreLastSearch();

// The page is kept alive while you visit other pages (see App.vue), so coming back shows the same results, filters,
// page and selection instead of searching again; it only has to reopen the last search when the URL has no term.
// This page is loaded asynchronously inside the modeRoute wrapper, so this hook is registered after the wrapper's own first
// activation and is only called when you come back. Running on every call is harmless: it does nothing when the URL has a term.
onActivated(() => {
    restoreLastSearch();
});

watch(
    () => route.query.searchTerm,
    async (newSearchTerm) => {
        // Back on the term already shown: keep those results.
        if (newSearchTerm && newSearchTerm === searchTerm.value) return;
        if (newSearchTerm) {
            searchAbort?.abort();
            selectMode.value = false;
            const abort = (searchAbort = new AbortController());
            filter.value = 'All';
            channelFilter.value = 'All';
    versionFilter.value = 'All';
            loading.value = true;
            loadingMore.value = true;
            searchResults.value = [];
            searchTerm.value = newSearchTerm;
            searchInput.value = newSearchTerm;
            rememberSearch(newSearchTerm);
            loadManualSettings();
            try {
                await streamSearch(
                    newSearchTerm,
                    (batch) => {
                        if (abort.signal.aborted) return;
                        searchResults.value.push(...batch);
                        loading.value = false;
                    },
                    abort.signal,
                    (found) => {
                        if (abort.signal.aborted) return;
                        // Collections are results like any other (own type, so the type filter covers them), listed first.
                        searchResults.value.unshift(...found.map(collectionResult));
                        loading.value = false;
                    }
                );
            } catch {
                // Keep whatever arrived; an empty list reads as "No Results Found".
            }
            if (!abort.signal.aborted) {
                loading.value = false;
                loadingMore.value = false;
            }
        }
    },
    { immediate: true }
);

// Radio results: a programme opens its radio page; an episode plays and downloads through the radio actions.
const radio = useRadioActions();
const radioEpisode = radioEpisodeOf;

const download = (searchResult) => {
    if (searchResult.radio) {
        if (searchResult.kind === 'brand') router.push(`/browse/radio/${searchResult.pid}`);
        else {
            askRadioDownload(`Download ${searchResult.title}${searchResult.episodeTitle ? ` - ${searchResult.episodeTitle}` : ''}?`)
                .then((mode) => mode && radio.download(radioEpisode(searchResult), mode))
                .then((queued) => queued && router.push('/queue'));
        }
        return;
    }
    const modal = useModal({
        component: DownloadConfirmModal,
        attrs: {
            result: searchResult,
            onDownloaded: () => {
                modal.close();
                router.push('/queue');
            },
        },
    });
    modal.open();
};

// The download button on a row. A result with audio described / signed versions asks which one (the download
// dialog has the choice) unless Settings says to use the default.
const immediateDownload = async (searchResult, media, version = quickVersion(searchResult)) => {
    if (media === undefined && version === undefined && askAboutVersions() && !searchResult.version && searchResult.versions?.length) {
        download(searchResult);
        return;
    }
    await sendDownload(searchResult, media, version);
};

const sendDownload = async (searchResult, media, version) => {
    if (searchResult.radio) return download(searchResult);
    const response = await ipFetch(`json-api/download?${buildDownloadQuery({ ...searchResult, media, version })}`);
    if (response.ok) {
        router.push('/queue');
    }
};

const preview = (searchResult) => {
    if (searchResult.radio) return searchResult.kind === 'brand' ? download(searchResult) : radio.play(radioEpisode(searchResult));
    // A result that is itself a version (the audio described row) plays that cut; others ask or use the default.
    if (searchResult.version) playInPip(searchResult.pid, searchResult.title, false, searchResult.version);
    else playProgramme(searchResult.pid, searchResult.title, searchResult.versions);
};

// The ticked radio episodes: one question for all of them, then queued together (a programme row is not an episode).
const radioBatchDownload = async (rows) => {
    const episodes = rows.filter((row) => row.kind === 'episode');
    if (!episodes.length) return 0;
    const mode = await askRadioDownload(`Download ${episodes.length} radio episode${episodes.length === 1 ? '' : 's'}?`, episodes.length);
    return mode ? radio.downloadMany(episodes.map(radioEpisode), mode) : 0;
};

const multipleImmediateDownload = async () => {
    const ticked = filteredResults.value.filter((result) => result.checked);
    const selectedResults = ticked.filter((result) => !result.radio);
    const radioQueued = await radioBatchDownload(ticked.filter((result) => result.radio));
    if (radioQueued && !selectedResults.length) router.push('/queue');
    if (selectedResults.length > 0) {
        const sizes = selectedResults.map((result) => estimateSizeMb(globalSettings.value, result));
        const offered = offeredVersions(selectedResults);
        const choice = await dialogService.confirmDownload(`Do you want to download ${selectedResults.length} items?`, {
            count: selectedResults.length,
            totalMb: sizes.some((size) => size === undefined) ? undefined : sizes.reduce((sum, size) => sum + size, 0),
            versions: offered,
            initialVersion: initialVersionKey(offered),
        });
        if (choice) {
            loading.value = true;
            // Only sent when it differs from the setting.
            const override = choice.media === defaultMediaMode(globalSettings.value) ? undefined : choice.media;
            for (const { item, version } of planDownloads(selectedResults, batchVersionKey(choice, offered))) {
                await sendDownload(item, override, version);
            }
        }
    }
};

const selectFilter = (option) => {
    filter.value = option;
    resultsPage.value = 1;
};

watch(
    allChecked,
    (newValue) => {
        downloadableResults.value.forEach((result) => {
            result.checked = newValue;
        });
    },
    { immediate: true }
);
</script>

<style lang="less" scoped>
// A bare icon button: keeps the icon's look while giving the download action an accessible name.
.rowIconButton {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

// The title and toolbar open the page like every other; the search box follows with its own spacing.
.searchTop {
    padding-bottom: 0;
}

.pageSearchBar {
    padding: 1rem 1rem 0.75rem;

    // The search box is the page's own (the top bar hides its box here): one roomy field.
    .searchPanel {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 720px;
        padding: 0 @space-2 0 14px;
        border: 1px solid @input-border-color;
        border-radius: @radius-lg;
        background-color: @input-background-color;
        transition: border-color 0.2s ease-out;

        &:focus-within {
            border-color: @brand-color;
        }

        .searchIcon {
            flex: 0 0 auto;
            color: @subtle-text-color;
        }

        .searchBox {
            flex: 1;
            min-width: 0;
            height: 46px;
            padding: 0;
            border: 0;
            background: transparent;
            color: @primary-text-color;
            // 16px stops iOS Safari zooming the page when the box is focused.
            font-size: @font-size-lead;
            border-radius: 0;
            box-shadow: none;

            &:focus {
                outline: none;
                box-shadow: none;
            }
        }

        .clearSearch {
            flex: 0 0 auto;
            width: 32px;
            height: 32px;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: @subtle-text-color;
            cursor: pointer;

            &:hover {
                color: @primary-text-color;
            }
        }

        .suggestions {
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            right: 0;
            margin: 0;
            padding: @space-1 0;
            list-style: none;
            z-index: @z-dropdown;
            border-radius: @menu-radius;
            border: 1px solid @menu-border-color;
            background-color: @menu-background-color;
            box-shadow: @menu-shadow;

            li {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 14px;
                cursor: pointer;
                font-size: @font-size-md;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;

                svg {
                    color: @subtle-text-color;
                }

                &:hover,
                &.active {
                    background-color: @settings-button-hover-background-color;
                }

                &.noMatches {
                    color: @subtle-text-color;
                    cursor: default;
                }

                &.seeAll {
                    color: @primary-color;
                    border-top: 1px solid @settings-button-border-color;
                    margin-top: @space-1;
                }
            }
        }
    }
}

.searchSettingsNote {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: @space-1 @space-2;
    margin: 14px 0 0;
    font-size: @font-size-base;
    color: @subtle-text-color;

    a {
        color: @brand-color;
    }
}

.resultsToolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;

    .resultCount {
        font-size: @font-size-base;
        color: @subtle-text-color;
    }

    .loadingMoreNote {
        margin-left: @space-2;
    }
}

.channelChips {
    display: flex;
    gap: @space-2;
    margin-bottom: @space-3;
    padding-bottom: @space-1;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
        display: none;
    }
}

.selectBar {
    display: flex;
    align-items: center;
    gap: @space-2;
    margin-bottom: 10px;
    font-size: @font-size-base;
    color: @subtle-text-color;

    span {
        margin-right: auto;
    }

    button {
        // Flex centring keeps the icon glyph in the middle of the square whatever the font metrics.
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        width: 32px;
        height: 32px;
        border: 1px solid @settings-button-border-color;
        border-radius: @radius-sm;
        background: transparent;
        color: @primary-text-color;
        cursor: pointer;

        &:disabled {
            opacity: 0.4;
            cursor: default;
        }
    }
}

.titleBadges {
    margin-left: 6px;
}

.chipDivider {
    flex: 0 0 1px;
    align-self: stretch;
    margin: @space-1 2px;
    background-color: @settings-button-border-color;
}

.chipRow {
    display: flex;
    flex-wrap: wrap;
    gap: @space-2;
}

.searchHome h2 {
    margin: 18px 0 @space-2;
    font-size: @font-size-sm;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: @subtle-text-color;
}

.emptyState {
    padding: 28px @space-4 @space-2;
    text-align: center;
    color: @subtle-text-color;

    .emptyIcon {
        margin-bottom: 10px;
        font-size: 28px;
    }

    .emptyTitle {
        font-size: @font-size-lead;
        color: @primary-text-color;
    }

    .emptyHint {
        margin-top: @space-1;
        font-size: @font-size-base;
    }
}

.resultsTable {
    max-width: 100%;
    width: 100%;
    border-collapse: collapse;
    font-size: @font-size-md;
    color: @table-text-color;
    // Fixed so the <colgroup> widths above are authoritative regardless of cell content -
    // without this, a page of short titles/filenames vs. one with long ones sizes columns
    // differently, shifting everything sideways when paging between them.
    table-layout: fixed;

    thead {
        th {
            padding: @space-2;
            border-bottom: 1px solid @table-border-color;
            text-align: left;
            font-weight: bold;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;

            &:first-child,
            &:nth-last-child(-n + 2) {
                text-align: center;

                :deep(.CheckInput-container) {
                    justify-content: center;
                }
            }
        }
    }

    tbody {
        tr {
            transition: background-color 500ms;

            &:hover {
                background-color: @table-row-hover-color;
            }

            td {
                padding: @space-2;
                border-top: 1px solid @table-border-color;
                line-height: 1.52857143;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;

                // Filenames can genuinely need the extra height - deliberately excluded from
                // the single-line ellipsis truncation every other column gets.
                &.text {
                    white-space: normal;
                }

                .filename {
                    font-size: @font-size-sm;
                    color: @subtle-text-color;
                    word-break: break-all;
                }

                &:first-child,
                &:nth-last-child(-n + 2) {
                    text-align: center;

                    :deep(.CheckInput-container) {
                        justify-content: center;
                    }
                }
            }
        }
    }
}
</style>
