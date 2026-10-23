<template>
    <div class="pageSearchBar">
        <div class="searchPanel">
            <font-awesome-icon class="searchIcon" :icon="['fas', 'search']" />
            <input
                ref="searchEl" v-model="searchInput" class="searchBox" type="text"
                placeholder="Search programmes, or paste a BBC URL" autocomplete="off" enterkeyhint="search"
                @input="onInput" @focus="onInput" @blur="closeSuggestions"
                @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)"
                @keydown.esc="closeSuggestions" @keyup.enter="onEnter" />
            <button v-if="searchInput" type="button" class="clearSearch" title="Clear" aria-label="Clear" @mousedown.prevent="clearInput">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
            <ul v-if="showSuggestions && suggestions.length" class="suggestions">
                <li
                    v-for="(suggestion, index) in suggestions" :key="suggestion.pid"
                    :class="{ active: index === activeIndex }" @mousedown.prevent="openSuggestion(suggestion)"
                >
                    <font-awesome-icon :icon="['fas', 'tv']" />
                    <span>{{ suggestion.title }}</span>
                </li>
                <li class="seeAll" @mousedown.prevent="runSearch">See all results for "{{ searchInput }}"</li>
            </ul>
        </div>
    </div>
    <SettingsPageToolbar :icons="toolbarIcons" @download="multipleImmediateDownload">
        <template #actions>
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
    <div v-if="!loading" class="inner-content scroll-x">
        <p v-if="searchTerm && searchSettingsLine" class="searchSettingsNote">
            <font-awesome-icon :icon="['fas', 'sliders']" />
            <span>{{ searchSettingsLine }}</span>
            <router-link :to="{ path: '/settings', hash: '#general' }">Change in Settings</router-link>
        </p>
        <div v-if="searchResults.length" class="resultsToolbar">
            <span class="resultCount">
                {{ filteredResults.length }} result{{ filteredResults.length === 1 ? '' : 's' }}
                <template v-if="searchTerm">for &ldquo;{{ searchTerm }}&rdquo;</template>
                <span v-if="loadingMore" class="loadingMoreNote">
                    <font-awesome-icon :icon="['fas', 'circle-notch']" spin /> more arriving
                </span>
            </span>
            <ViewToggle :model-value="viewMode" :modes="['table', 'posters']" @update:model-value="setViewMode" />
        </div>
        <div v-if="typeOptions.length > 2 || channelOptions.length > 2" class="channelChips" role="group" aria-label="Filter results">
            <template v-if="typeOptions.length > 2">
                <button
                    v-for="option in typeOptions" :key="`type-${option}`" type="button"
                    :class="['chip', filter === option ? 'active' : '']" @click="selectFilter(option)"
                >
                    {{ option === 'All' ? 'All types' : option }}
                </button>
                <span v-if="channelOptions.length > 2" class="chipDivider" aria-hidden="true"></span>
            </template>
            <template v-if="channelOptions.length > 2">
                <button
                    v-for="option in channelOptions" :key="option" type="button"
                    :class="['chip', channelFilter === option ? 'active' : '']" @click="pickChannel(option)"
                >
                    {{ option === 'All' ? 'All channels' : option }}
                </button>
            </template>
        </div>
        <TablePagination v-model="resultsPage" v-model:page-size="resultsPageSize" :total="filteredResults.length" />
        <div v-if="selectMode && viewMode === 'posters' && searchResults.length" class="selectBar">
            <span>{{ selectedCount }} of {{ filteredResults.length }} selected</span>
            <button type="button" :title="`Select all ${filteredResults.length} results`" :aria-label="`Select all ${filteredResults.length} results`" @click="setAllChecked(true)">
                <font-awesome-icon :icon="['fas', 'check-double']" />
            </button>
            <button type="button" title="Clear selection" aria-label="Clear selection" :disabled="!selectedCount" @click="setAllChecked(false)">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
        </div>
        <div v-if="viewMode === 'posters' && filteredResults.length" class="browseGrid">
            <ProgrammeCard
                v-for="item in posterItems" :key="item.pid" :item="item"
                :selectable="selectMode" :selected="!!item.result.checked" @toggle="item.result.checked = !item.result.checked"
            />
        </div>
        <table v-else-if="filteredResults.length" class="resultsTable responsive-table">
            <colgroup>
                <col style="width: 40px" />
                <col style="width: 70px" />
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
                <tr v-for="result of pagedResults" :key="result.pid" class="clickable">
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
                        <div class="filename">{{ result.nzbName }}</div>
                    </td>
                    <td
                        data-title="Series"
                        :title="result.seriesPid ? 'View Series' : undefined"
                        @click="result.seriesPid ? router.push(`/browse/programme/${result.seriesPid}`) : download(result)"
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
                        <font-awesome-icon
                            :class="['clickable', result.downloading ? 'downloading' : '']"
                            :icon="['fas', 'cloud-download']"
                        />
                    </td>
                    <td>
                        <font-awesome-icon
                            class="clickable"
                            :icon="['fas', 'play']"
                            title="Play Video"
                            @click="preview(result)"
                        />
                    </td>
                </tr>
            </tbody>
        </table>
        <TablePagination v-model="resultsPage" v-model:page-size="resultsPageSize" :total="filteredResults.length" />
        <div v-if="filteredResults.length == 0 && !loadingMore && searchTerm" class="emptyState">
            <font-awesome-icon class="emptyIcon" :icon="['fas', 'magnifying-glass']" />
            <div class="emptyTitle">
                {{ searchResults.length ? 'Nothing matches that filter' : `No results for “${searchTerm}”` }}
            </div>
            <div v-if="!searchResults.length" class="emptyHint">Try fewer words, or one of your recent searches below.</div>
        </div>
        <div v-if="showHome" class="searchHome">
            <section v-if="recent.length">
                <h3>Recent searches</h3>
                <div class="chipRow">
                    <button v-for="term in recent" :key="term" type="button" class="chip" @click="searchFor(term)">
                        <font-awesome-icon :icon="['fas', 'clock-rotate-left']" />{{ term }}
                    </button>
                </div>
            </section>
        </div>
    </div>
    <LoadingIndicator v-if="loading" />
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRoute, useRouter } from 'vue-router';

import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import ChannelPill from '@/components/common/ChannelPill.vue';
import CheckInput from '@/components/common/form/CheckInput.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import ViewToggle from '@/components/common/ViewToggle.vue';
import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { browseFetch } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { streamSearch } from '@/lib/searchStream';
import { usePagination } from '@/lib/usePagination';
import { useViewMode } from '@/lib/useViewMode';
import { buildDownloadQuery, formatDate, formatStorageSize } from '@/lib/utils';

const route = useRoute();
const router = useRouter();

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
    if (!settings) return '';
    const parts = [settings.native ? `Native ${settings.engine === 'V2' ? '2.0' : '1.0'}` : 'get_iplayer search'];
    if (settings.native) {
        parts.push(settings.matchAllWords ? 'all words must match' : 'any word may match');
        if (settings.requestedSeriesOnly) parts.push('requested series only');
    }
    // All four inherited: manual search is simply doing what Sonarr and Radarr get.
    const shared = settings.inherited.length === 4 ? ' (same as Sonarr/Radarr)' : '';
    return `Manual search: ${parts.join(' · ')}${shared}`;
});

const toolbarIcons = computed(() => {
    const icons = [];
    // The table has its own checkboxes; in the poster view the button needs a selection to act on.
    if (viewMode.value === 'posters' ? selectedCount.value > 0 : filteredResults.value.length) icons.push('download');
    return icons;
});

// As-you-type suggestions (titles only, from the browse API) - mirrors the nav bar's search box.
// Debounced, and a request counter drops responses that arrive after a newer keystroke.
const suggestions = ref([]);
const showSuggestions = ref(false);
const activeIndex = ref(-1);
let suggestTimer = null;
let suggestRequest = 0;

const closeSuggestions = () => {
    showSuggestions.value = false;
    activeIndex.value = -1;
    suggestRequest += 1;
    clearTimeout(suggestTimer);
};

const onInput = () => {
    clearTimeout(suggestTimer);
    const term = (searchInput.value ?? '').trim();
    // URLs go straight to the download path on Enter - nothing to suggest for them.
    if (term.length < 2 || /[/:]/.test(term)) {
        closeSuggestions();
        return;
    }
    suggestTimer = setTimeout(async () => {
        const request = ++suggestRequest;
        try {
            const { data, ok } = await ipFetch(`json-api/browse/suggest?q=${encodeURIComponent(term)}`);
            if (request === suggestRequest && ok && Array.isArray(data)) {
                suggestions.value = data;
                activeIndex.value = -1;
                showSuggestions.value = true;
            }
        } catch {
            // Suggestions are a nicety - Enter still runs a normal search.
        }
    }, 250);
};

const moveActive = (delta) => {
    if (!showSuggestions.value || !suggestions.value.length) return;
    // Cycles through the suggestions, with -1 meaning "none highlighted" (Enter = plain search).
    const count = suggestions.value.length;
    const next = activeIndex.value + delta;
    activeIndex.value = next < -1 ? count - 1 : next >= count ? -1 : next;
};

const openSuggestion = (suggestion) => {
    closeSuggestions();
    searchInput.value = '';
    router.push(`/browse/programme/${suggestion.pid}`);
};

const onEnter = () => {
    const picked = showSuggestions.value ? suggestions.value[activeIndex.value] : undefined;
    if (picked) {
        openSuggestion(picked);
    } else {
        closeSuggestions();
        runSearch();
    }
};

const selectedCount = computed(() => searchResults.value.filter((result) => result.checked).length);

const setAllChecked = (value) => {
    filteredResults.value.forEach((result) => {
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
    closeSuggestions();
    searchEl.value?.focus();
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

onMounted(async () => {
    if (!searchInput.value) searchEl.value?.focus();
    try {
        const { ok, data } = await ipFetch('json-api/stats/searchHistory?limit=80&filterRss=true');
        if (ok && Array.isArray(data)) {
            const seen = new Set();
            // Searches typed here have no app behind them (Sonarr/Radarr ones do); newest first, each term once.
            recent.value = data
                .filter(({ term, appId }) => term && term !== '*' && !appId)
                .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
                .map(({ term }) => term.trim())
                .filter((term) => term && !seen.has(term.toLowerCase()) && seen.add(term.toLowerCase()))
                .slice(0, 8);
        }
    } catch {
        // Recent searches are a nicety.
    }
});

const runSearch = () => {
    closeSuggestions();
    filter.value = 'All';
    channelFilter.value = 'All';
    router.push({ name: 'search', query: { searchTerm: searchInput.value } });
};

// Only offered when the results really mix TV and movies.
const typeOptions = computed(() => [
    'All',
    ...['TV', 'Movie'].filter((type) => searchResults.value.some((result) => result.type === type.toUpperCase())),
]);

const channelFilter = ref('All');
const channelOptions = computed(() => [
    'All',
    ...[...new Set(searchResults.value.map(({ channel }) => channel).filter(Boolean))].sort(),
]);

const filteredResults = computed(() => {
    return searchResults.value.filter(
        ({ type, channel }) =>
            (filter.value == 'All' || type == filter.value.toUpperCase()) &&
            (channelFilter.value == 'All' || channel == channelFilter.value)
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
const thumbnails = ref({});
const requestedThumbnails = new Set();
watch(
    [pagedResults, viewMode],
    async ([results, mode]) => {
        if (mode !== 'posters') return;
        const missing = results.map(({ pid }) => pid).filter((pid) => !requestedThumbnails.has(pid));
        if (missing.length === 0) return;
        missing.forEach((pid) => requestedThumbnails.add(pid));
        try {
            const details = await browseFetch(`details?pids=${missing.join(',')}`);
            const found = {};
            details.forEach(({ pid, thumbnail }) => {
                if (thumbnail) found[pid] = thumbnail;
            });
            thumbnails.value = { ...thumbnails.value, ...found };
        } catch {
            // Posters just fall back to the placeholder tile.
            missing.forEach((pid) => requestedThumbnails.delete(pid));
        }
    },
    { immediate: true }
);

const posterItems = computed(() =>
    pagedResults.value.map((result) => ({
        pid: result.pid,
        seriesPid: result.seriesPid,
        kind: 'episode',
        type: result.type,
        title: result.title,
        subtitle: result.episode ? `Series ${result.series}, Episode ${result.episode}` : result.episodeTitle,
        episodeTitle: result.episodeTitle,
        series: result.series,
        episode: result.episode,
        channel: result.channel,
        pubDate: result.pubDate,
        nzbName: result.nzbName,
        thumbnail: thumbnails.value[result.pid],
        result,
    }))
);

// Results stream in: the table appears with the first batch while the rest keep arriving behind it.
// A new search aborts the previous stream so its late batches can't land in the new results.
let searchAbort = null;
watch(
    () => route.query.searchTerm,
    async (newSearchTerm) => {
        if (newSearchTerm) {
            searchAbort?.abort();
            selectMode.value = false;
            const abort = (searchAbort = new AbortController());
            filter.value = 'All';
            channelFilter.value = 'All';
            loading.value = true;
            loadingMore.value = true;
            searchResults.value = [];
            searchTerm.value = newSearchTerm;
            searchInput.value = newSearchTerm;
            loadManualSettings();
            try {
                await streamSearch(
                    newSearchTerm,
                    (batch) => {
                        if (abort.signal.aborted) return;
                        searchResults.value.push(...batch);
                        loading.value = false;
                    },
                    abort.signal
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

const download = (searchResult) => {
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

const immediateDownload = async (searchResult) => {
    const response = await ipFetch(`json-api/download?${buildDownloadQuery(searchResult)}`);
    if (response.ok) {
        router.push('/queue');
    }
};

const preview = (searchResult) => {
    playInPip(searchResult.pid, searchResult.title);
};

const multipleImmediateDownload = async () => {
    const selectedResults = filteredResults.value.filter((result) => result.checked);
    if (selectedResults.length > 0) {
        if (await dialogService.confirm('Download', `Do you want to download ${selectedResults.length} items?`)) {
            loading.value = true;
            for (const item of selectedResults) {
                await immediateDownload(item);
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
        filteredResults.value.forEach((result) => {
            result.checked = newValue;
        });
    },
    { immediate: true }
);
</script>

<style lang="less" scoped>
.pageSearchBar {
    padding: 1rem 1rem 0.75rem;

    // The search box is the page's own (the top bar hides its box here): one roomy field.
    .searchPanel {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 720px;
        padding: 0 8px 0 14px;
        border: 1px solid @input-border-color;
        border-radius: 8px;
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
            font-size: 16px;
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
            padding: 4px 0;
            list-style: none;
            z-index: 10;
            border-radius: 6px;
            border: 1px solid @settings-button-border-color;
            background-color: @nav-active-background-color;
            box-shadow: 0 6px 18px @shadow-color;

            li {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 14px;
                cursor: pointer;
                font-size: 14px;
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

                &.seeAll {
                    color: @primary-color;
                    border-top: 1px solid @settings-button-border-color;
                    margin-top: 4px;
                }
            }
        }
    }
}

.searchSettingsNote {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 0 0 10px;
    font-size: 13px;
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
        font-size: 13px;
        color: @subtle-text-color;
    }

    .loadingMoreNote {
        margin-left: 8px;
    }
}

// Filter chips (channel) and the home / empty-state chips share one look.
.chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 6px 12px;
    border: 1px solid @settings-button-border-color;
    border-radius: 16px;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    font-size: 13px;
    text-decoration: none;
    cursor: pointer;

    svg {
        color: @subtle-text-color;
    }

    &:hover {
        background-color: @settings-button-hover-background-color;
    }

    &.active {
        border-color: @brand-color;
        color: @brand-color;
    }
}

.channelChips {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 4px;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
        display: none;
    }
}

.selectBar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
    color: @subtle-text-color;

    span {
        margin-right: auto;
    }

    button {
        width: 32px;
        height: 32px;
        border: 1px solid @settings-button-border-color;
        border-radius: 4px;
        background: transparent;
        color: @primary-text-color;
        cursor: pointer;

        &:disabled {
            opacity: 0.4;
            cursor: default;
        }
    }
}

.chipDivider {
    flex: 0 0 1px;
    align-self: stretch;
    margin: 4px 2px;
    background-color: @settings-button-border-color;
}

.chipRow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.searchHome h3 {
    margin: 18px 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: @subtle-text-color;
}

.emptyState {
    padding: 28px 16px 8px;
    text-align: center;
    color: @subtle-text-color;

    .emptyIcon {
        margin-bottom: 10px;
        font-size: 28px;
    }

    .emptyTitle {
        font-size: 16px;
        color: @primary-text-color;
    }

    .emptyHint {
        margin-top: 4px;
        font-size: 13px;
    }
}

.resultsTable {
    max-width: 100%;
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    color: @table-text-color;
    // Fixed so the <colgroup> widths above are authoritative regardless of cell content -
    // without this, a page of short titles/filenames vs. one with long ones sizes columns
    // differently, shifting everything sideways when paging between them.
    table-layout: fixed;

    thead {
        th {
            padding: 8px;
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
                padding: 8px;
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
                    font-size: 12px;
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

.pill {
    &.BBCOne {
        background-color: @error-color;
        border-color: @error-color;
        color: @error-text-color;
    }

    &.BBCTwo {
        background-color: @primary-color;
        border-color: @primary-color;
        color: @on-fill-color;
    }

    &.BBCThree {
        background-color: @brand-color;
        border-color: @brand-color;
        color: @on-brand-color;
        color: @primary-text-color;
    }

    &.CBeebies {
        background-color: @complete-color;
        border-color: @complete-color;
        color: @on-fill-color;
    }

    &.CBBC {
        background-color: @success-color;
        border-color: @success-color;
        color: @on-fill-color;
    }
}

@media (max-width: @mobile-breakpoint) {
    .chip {
        min-height: 36px;
    }
}
</style>
