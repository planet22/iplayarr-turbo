<template>
    <div class="inner-content scroll-x">
        <InfoBar>
            Diagnostics for the Newznab/SABnzbd integration - only reflects searches and grabs from Sonarr, Radarr, or
            Prowlarr, not manual searches/downloads from within iPlayarr itself.
        </InfoBar>

        <legend>Recent Searches</legend>
        <table class="dataTable">
            <thead>
                <tr>
                    <th>Term</th>
                    <th>Results</th>
                    <th>Season</th>
                    <th>Episode</th>
                    <th>App</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(entry, index) in pagedSearches" :key="index">
                    <td>{{ entry.term == '*' ? 'RSS Feed' : entry.term }}</td>
                    <td>{{ entry.results }}</td>
                    <td>{{ entry.series ?? '' }}</td>
                    <td>{{ entry.episode ?? '' }}</td>
                    <td>{{ appName(entry.appId) }}</td>
                    <td>{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="reversedSearches.length == 0">
                    <td colspan="6" class="empty">No searches recorded yet</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="searchPage" :total="reversedSearches.length" :page-size="pageSize" />

        <legend>Recent Grabs</legend>
        <table class="dataTable">
            <thead>
                <tr>
                    <th>PID</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>App</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(entry, index) in pagedGrabs" :key="index">
                    <td>{{ entry.pid }}</td>
                    <td>{{ entry.nzbName }}</td>
                    <td><span class="pill">{{ entry.type }}</span></td>
                    <td>{{ appName(entry.appId) }}</td>
                    <td>{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="reversedGrabs.length == 0">
                    <td colspan="5" class="empty">No grabs recorded yet</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="grabPage" :total="reversedGrabs.length" :page-size="pageSize" />

        <SettingsPageToolbar :icons="['delete']" delete-label="Clear Failed" @delete-queue-item="clearFailedGrabs" />
        <legend>Failed Grabs</legend>
        <table class="dataTable">
            <thead>
                <tr>
                    <th>PID</th>
                    <th>Name</th>
                    <th>Error</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(entry, index) in pagedFailedGrabs" :key="index">
                    <td>{{ entry.pid }}</td>
                    <td>{{ entry.nzbName }}</td>
                    <td class="text">{{ entry.error }}</td>
                    <td>{{ formatDate(entry.time) }}</td>
                </tr>
                <tr v-if="reversedFailedGrabs.length == 0">
                    <td colspan="4" class="empty">No failed grabs</td>
                </tr>
            </tbody>
        </table>
        <Pagination v-model="failedGrabPage" :total="reversedFailedGrabs.length" :page-size="pageSize" />
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

import InfoBar from '@/components/common/InfoBar.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import Pagination from '@/components/common/TablePagination.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

const pageSize = 25;

const searchHistory = ref([]);
const grabHistory = ref([]);
const failedGrabHistory = ref([]);
const apps = ref([]);

const searchPage = ref(1);
const grabPage = ref(1);
const failedGrabPage = ref(1);

const reversedSearches = computed(() => [...searchHistory.value].reverse());
const reversedGrabs = computed(() => [...grabHistory.value].reverse());
const reversedFailedGrabs = computed(() => [...failedGrabHistory.value].reverse());

function page(list, pageNumber) {
    const start = (pageNumber - 1) * pageSize;
    return list.slice(start, start + pageSize);
}

const pagedSearches = computed(() => page(reversedSearches.value, searchPage.value));
const pagedGrabs = computed(() => page(reversedGrabs.value, grabPage.value));
const pagedFailedGrabs = computed(() => page(reversedFailedGrabs.value, failedGrabPage.value));

onMounted(async () => {
    await refresh();
    apps.value = (await ipFetch('json-api/apps')).data;
});

async function refresh() {
    searchHistory.value = (await ipFetch('json-api/stats/searchHistory?filterRss=true')).data;
    grabHistory.value = (await ipFetch('json-api/stats/grabHistory')).data;
    failedGrabHistory.value = (await ipFetch('json-api/stats/failedGrabHistory')).data;
}

function appName(appId) {
    if (!appId) return '';
    return apps.value.find(({ id }) => id == appId)?.name ?? '';
}

function formatDate(time) {
    if (!time) return '';
    return new Date(time).toLocaleString();
}

const clearFailedGrabs = async () => {
    if (await dialogService.confirm('Clear Failed Grabs', 'Are you sure you want to clear the failed grabs log?')) {
        await ipFetch('json-api/stats/failedGrabHistory', 'DELETE');
        failedGrabHistory.value = [];
        failedGrabPage.value = 1;
    }
};
</script>
