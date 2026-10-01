<template>
    <div class="inner-content scroll-x">
        <InfoBar>
            Diagnostics for the Newznab/SABnzbd integration - only reflects searches and grabs from Sonarr, Radarr, or
            Prowlarr, not manual searches/downloads from within iPlayarr itself.
        </InfoBar>

        <legend>Recent Searches</legend>
        <div class="tableToolbar">
            <DateRangeFilter v-model="searchDateFrom" v-model:model-value-to="searchDateTo" />
            <input v-model="searchFilterText" class="tableFilter" type="text" placeholder="Filter searches..." />
        </div>
        <table class="dataTable responsive-table">
            <colgroup>
                <col />
                <col style="width: 10ch" />
                <col style="width: 10ch" />
                <col style="width: 10ch" />
                <col style="width: 14ch" />
                <col style="width: 22ch" />
            </colgroup>
            <thead>
                <tr>
                    <th class="sortable" @click="toggleSearchSort('term')">
                        Term <SortIcon :active="searchSortBy == 'term'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('results')">
                        Results <SortIcon :active="searchSortBy == 'results'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('series')">
                        Season <SortIcon :active="searchSortBy == 'series'" :order="searchSortOrder" />
                    </th>
                    <th class="sortable" @click="toggleSearchSort('episode')">
                        Episode <SortIcon :active="searchSortBy == 'episode'" :order="searchSortOrder" />
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
                    <td data-title="Results">
                        <a v-if="entry.items?.length" class="clickable" @click="showResults(entry)">{{ entry.results }}</a>
                        <template v-else>{{ entry.results }}</template>
                    </td>
                    <td data-title="Season">{{ entry.series ?? '' }}</td>
                    <td data-title="Episode">{{ entry.episode ?? '' }}</td>
                    <td data-title="App">{{ appName(entry.appId) }}</td>
                    <td data-title="Time">{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="sortedSearches.length == 0">
                    <td colspan="6" class="empty">No searches recorded yet</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="searchPage" v-model:page-size="searchPageSize" :total="sortedSearches.length" />

        <legend>Recent Grabs</legend>
        <div class="tableToolbar">
            <DateRangeFilter v-model="grabDateFrom" v-model:model-value-to="grabDateTo" />
            <input v-model="grabFilterText" class="tableFilter" type="text" placeholder="Filter grabs..." />
        </div>
        <table class="dataTable responsive-table">
            <colgroup>
                <col style="width: 14ch" />
                <col />
                <col style="width: 10ch" />
                <col style="width: 14ch" />
                <col style="width: 22ch" />
            </colgroup>
            <thead>
                <tr>
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
                    <td data-title="PID">{{ entry.pid }}</td>
                    <td class="text">{{ entry.nzbName }}</td>
                    <td data-title="Type"><span class="pill">{{ entry.type }}</span></td>
                    <td data-title="App">{{ appName(entry.appId) }}</td>
                    <td data-title="Time">{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="sortedGrabs.length == 0">
                    <td colspan="5" class="empty">No grabs recorded yet</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="grabPage" v-model:page-size="grabPageSize" :total="sortedGrabs.length" />

        <SettingsPageToolbar :icons="['delete']" delete-label="Clear Failed" @delete-queue-item="clearFailedGrabs" />
        <legend>Failed Grabs</legend>
        <div class="tableToolbar">
            <DateRangeFilter v-model="failedGrabDateFrom" v-model:model-value-to="failedGrabDateTo" />
            <input v-model="failedGrabFilterText" class="tableFilter" type="text" placeholder="Filter failed grabs..." />
        </div>
        <table class="dataTable responsive-table">
            <colgroup>
                <col style="width: 14ch" />
                <col />
                <col style="width: 38ch" />
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
                    <td data-title="Time">{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="sortedFailedGrabs.length == 0">
                    <td colspan="4" class="empty">No failed grabs</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="failedGrabPage" v-model:page-size="failedGrabPageSize" :total="sortedFailedGrabs.length" />
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useModal } from 'vue-final-modal';

import DateRangeFilter from '@/components/common/DateRangeFilter.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortIcon from '@/components/common/SortIcon.vue';
import Pagination from '@/components/common/TablePagination.vue';
import SearchResultsDialog from '@/components/modals/SearchResultsDialog.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { formatDateTimeWithMillis } from '@/lib/utils';

const searchHistory = ref([]);
const grabHistory = ref([]);
const failedGrabHistory = ref([]);
const apps = ref([]);

function appName(appId) {
    if (!appId) return '';
    return apps.value.find(({ id }) => id == appId)?.name ?? '';
}

const {
    filterText: searchFilterText, sortBy: searchSortBy, sortOrder: searchSortOrder,
    dateFrom: searchDateFrom, dateTo: searchDateTo, sorted: sortedSearches, toggleSort: toggleSearchSort,
} = useSortFilter(searchHistory, {
    filterFn: (entry, query) => [
        entry.term == '*' ? 'RSS Feed' : entry.term,
        appName(entry.appId),
    ].some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        term: (entry) => (entry.term == '*' ? 'RSS Feed' : entry.term ?? ''),
        results: (entry) => entry.results,
        series: (entry) => entry.series,
        episode: (entry) => entry.episode,
        app: (entry) => appName(entry.appId),
        time: (entry) => entry.time,
    },
    dateAccessor: (entry) => entry.time,
    storageKey: 'nzbSearchTable',
});

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

const {
    filterText: failedGrabFilterText, sortBy: failedGrabSortBy, sortOrder: failedGrabSortOrder,
    dateFrom: failedGrabDateFrom, dateTo: failedGrabDateTo, sorted: sortedFailedGrabs, toggleSort: toggleFailedGrabSort,
} = useSortFilter(failedGrabHistory, {
    filterFn: (entry, query) => [entry.pid, entry.nzbName, entry.error]
        .some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        pid: (entry) => entry.pid,
        nzbName: (entry) => entry.nzbName,
        error: (entry) => entry.error,
        time: (entry) => entry.time,
    },
    dateAccessor: (entry) => entry.time,
    storageKey: 'nzbFailedGrabTable',
});

const {
    page: searchPage, pageSize: searchPageSize, pagedItems: pagedSearches,
} = usePagination(sortedSearches);
const {
    page: grabPage, pageSize: grabPageSize, pagedItems: pagedGrabs,
} = usePagination(sortedGrabs);
const {
    page: failedGrabPage, pageSize: failedGrabPageSize, pagedItems: pagedFailedGrabs,
} = usePagination(sortedFailedGrabs);

onMounted(async () => {
    await refresh();
    apps.value = (await ipFetch('json-api/apps')).data;
});

async function refresh() {
    searchHistory.value = (await ipFetch('json-api/stats/searchHistory?filterRss=true')).data;
    grabHistory.value = (await ipFetch('json-api/stats/grabHistory')).data;
    failedGrabHistory.value = (await ipFetch('json-api/stats/failedGrabHistory')).data;
}

function formatDate(time) {
    if (!time) return '';
    return formatDateTimeWithMillis(time);
}

function showResults(entry) {
    const resultsModal = useModal({
        component: SearchResultsDialog,
        attrs: {
            term: entry.term,
            items: entry.items,
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
</script>
