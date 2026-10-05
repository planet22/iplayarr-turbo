<template>
    <div class="pageSearchBar">
        <div class="searchPanel">
            <font-awesome-icon :icon="['fas', 'search']" />
            <div class="searchWrap">
                <input
                    v-model="searchInput" class="searchBox" type="text" placeholder="Search or Download Url"
                    autocomplete="off" @input="onInput" @focus="onInput" @blur="closeSuggestions"
                    @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)"
                    @keydown.esc="closeSuggestions" @keyup.enter="onEnter" />
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
    </div>
    <SettingsPageToolbar
        :icons="toolbarIcons"
        :filter-options="availableFilters"
        :selected-filter="filter"
        :filter-enabled="filter != 'All'"
        @download="multipleImmediateDownload"
        @select-filter="selectFilter"
    />
    <div v-if="!loading" class="inner-content scroll-x">
        <div v-if="searchResults.length" class="viewToggle">
            <select v-if="channelOptions.length > 2" v-model="channelFilter" class="channelFilter" title="Filter by channel">
                <option v-for="option in channelOptions" :key="option" :value="option">
                    {{ option === 'All' ? 'All channels' : option }}
                </option>
            </select>
            <button
                :class="['clickable', viewMode === 'table' ? 'active' : '']"
                title="Table view"
                @click="setViewMode('table')"
            >
                <font-awesome-icon :icon="['fas', 'table-list']" />
            </button>
            <button
                :class="['clickable', viewMode === 'posters' ? 'active' : '']"
                title="Poster view"
                @click="setViewMode('posters')"
            >
                <font-awesome-icon :icon="['fas', 'table-cells-large']" />
            </button>
        </div>
        <div v-if="viewMode === 'posters' && filteredResults.length" class="browseGrid">
            <ProgrammeCard v-for="item in posterItems" :key="item.pid" :item="item" />
        </div>
        <table v-else class="resultsTable responsive-table">
            <colgroup>
                <col style="width: 40px" />
                <col style="width: 70px" />
                <col />
                <col style="width: 160px" />
                <col />
                <col style="width: 85px" />
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
                    <th>Episode</th>
                    <th>Filename</th>
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
                    </td>
                    <td data-title="Episode" @click="download(result)">
                        {{
                            result.episode ? `Series ${result.series}, Episode ${result.episode}` : result.episodeTitle
                        }}
                    </td>
                    <td class="wrap" data-title="Filename" @click="download(result)">
                        {{ result.nzbName }}
                    </td>
                    <td data-title="Est. Size" @click="download(result)">
                        {{ formatStorageSize(result.size) }}
                    </td>
                    <td data-title="Channel" @click="download(result)">
                        <span :class="['pill', result.channel.replaceAll(' ', '')]">
                            {{ result.channel }}
                        </span>
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
        <template v-if="filteredResults.length == 0">
            <p>No Results Found</p>
        </template>
    </div>
    <LoadingIndicator v-if="loading" />
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRoute, useRouter } from 'vue-router';

import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';
import CheckInput from '@/components/common/form/CheckInput.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { browseFetch } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { usePagination } from '@/lib/usePagination';
import { buildDownloadQuery, formatDate, formatStorageSize } from '@/lib/utils';

const route = useRoute();
const router = useRouter();

const searchResults = ref([]);
const searchTerm = ref('');
const searchInput = ref(route.query.searchTerm ?? '');
const loading = ref(searchTerm.value !== '');
const availableFilters = ref(['All', 'TV', 'Movie']);
const filter = ref('All');
const allChecked = ref(false);

const toolbarIcons = computed(() => {
    const icons = [];
    if (searchResults.value.length) icons.push('filter');
    if (filteredResults.value.length) icons.push('download');
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

const runSearch = () => {
    filter.value = 'All';
    channelFilter.value = 'All';
    router.push({ name: 'search', query: { searchTerm: searchInput.value } });
};

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

// Table (default) or poster grid. Remembered per browser; storage can be unavailable (private
// windows, blocked site data) so every access is guarded.
const VIEW_MODE_KEY = 'iplayarr.searchViewMode';
const readViewMode = () => {
    try {
        return localStorage.getItem(VIEW_MODE_KEY) === 'posters' ? 'posters' : 'table';
    } catch {
        return 'table';
    }
};
const viewMode = ref(readViewMode());
const setViewMode = (mode) => {
    viewMode.value = mode;
    try {
        localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
        // Not persisted - the toggle still works for this session.
    }
};

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
    }))
);

watch(
    () => route.query.searchTerm,
    async (newSearchTerm) => {
        if (newSearchTerm) {
            filter.value = 'All';
            channelFilter.value = 'All';
            loading.value = true;
            searchResults.value = [];
            searchTerm.value = newSearchTerm;
            searchInput.value = newSearchTerm;
            searchResults.value = (await ipFetch(`json-api/search?q=${searchTerm.value}`)).data;
            loading.value = false;
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
    padding: 1rem 1rem 0;

    .searchPanel {
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 480px;

        .searchWrap {
            position: relative;
            flex: 1;
            display: flex;
            align-items: center;
        }

        .searchBox {
            flex: 1;
            background-color: transparent;
            border: 0px;
            border-bottom: 1px solid @primary-text-color;
            padding: 5px 5px;
            color: @primary-text-color;
            border-radius: 0px;
            transition: border-bottom-color 0.3s ease-out;

            &:focus {
                outline: none;
                box-shadow: none;
                border-bottom-color: @brand-color;
            }
        }

        .suggestions {
            position: absolute;
            top: calc(100% - 4px);
            left: 0;
            right: 0;
            margin: 0;
            padding: 4px 0;
            list-style: none;
            z-index: 10;
            border-radius: 4px;
            border: 1px solid @settings-button-border-color;
            background-color: @nav-active-background-color;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);

            li {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 12px;
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

.viewToggle {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;

    .channelFilter {
        height: 30px;
        margin-right: 6px;
        padding: 0 8px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
    }

    button {
        width: 34px;
        height: 30px;
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
                &.wrap {
                    white-space: normal;
                    word-break: break-word;
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
        color: @primary-text-color;
    }

    &.BBCThree {
        background-color: @brand-color;
        border-color: @brand-color;
        color: @primary-text-color;
    }

    &.CBeebies {
        background-color: @complete-color;
        border-color: @complete-color;
        color: @primary-text-color;
    }

    &.CBBC {
        background-color: @success-color;
        border-color: @success-color;
        color: @primary-text-color;
    }
}
</style>
