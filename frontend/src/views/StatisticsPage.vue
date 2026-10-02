<template>
    <SettingsPageToolbar
        :icons="['filter']" :filter-enabled="range != 'All'" :filter-options="availableRanges"
        :selected-filter="range" @select-filter="selectRange" />
    <div class="inner-content">
        <legend>Server</legend>
        <div class="statRow">
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'clock']" />
                <div class="statBody">
                    <span class="statLabel">Uptime</span>
                    <span class="statValue">{{ msToTime(uptime.uptime) }}</span>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'magnifying-glass']" />
                <div class="statBody">
                    <span class="statLabel">Search Cache Size</span>
                    <span class="statValue">{{ cacheSizes.search }}MB</span>
                </div>
            </div>
            <div class="statCard">
                <font-awesome-icon class="statIcon" :icon="['fas', 'calendar-days']" />
                <div class="statBody">
                    <span class="statLabel">Schedule Cache Size</span>
                    <span class="statValue">{{ cacheSizes.schedule }}MB</span>
                </div>
            </div>
        </div>

        <div class="legendRow">
            <legend>Activity</legend>
            <button class="rssToggle clickable" :class="{ active: excludeRss }" @click="excludeRss = !excludeRss">
                {{ excludeRss ? 'RSS Excluded' : 'RSS Included' }}
            </button>
        </div>
        <div class="statRow">
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'magnifying-glass']" />
                    <div class="statBody">
                        <span class="statLabel">Searches (Today)</span>
                        <span class="statValue">{{ searchesToday }}</span>
                    </div>
                </div>
                <SparklineChart :data="searchesTrend" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'download']" />
                    <div class="statBody">
                        <span class="statLabel">Grabs (Today)</span>
                        <span class="statValue">{{ grabsToday }}</span>
                    </div>
                </div>
                <SparklineChart :data="grabsTrend" color="#888888" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                    <div class="statBody">
                        <span class="statLabel">Failed Grabs (Today)</span>
                        <span class="statValue">{{ failedGrabsToday }}</span>
                    </div>
                </div>
                <SparklineChart :data="failedGrabsTrend" color="#f05050" />
            </div>
        </div>
        <div class="chartRow">
            <div class="chartCard">
                <LineChart
                    title="Searches vs Grabs"
                    :series="[
                        { name: 'Searches', data: searchOverTimeSeries, color: '#F12D7F' },
                        { name: 'Grabs', data: grabOverTimeSeries, color: '#888888' },
                    ]"
                />
            </div>
        </div>

        <legend>Search Breakdown</legend>
        <div class="chartRow">
            <div class="chartCard">
                <PieChart :data="termSeries" title="Search Terms" />
            </div>
            <div class="chartCard">
                <BarChart :data="appSearchSeries" title="Search Sources" />
            </div>
        </div>
        <legend>Grab Breakdown</legend>
        <div class="chartRow">
            <div class="chartCard">
                <PieChart :data="typeSeries" title="Grab Types" />
            </div>
            <div class="chartCard">
                <BarChart :data="appGrabSeries" title="Grab Sources" />
            </div>
        </div>

        <legend>Top Content</legend>
        <div class="chartRow">
            <div class="chartCard">
                <h3 class="topContentHeading">Most Searched</h3>
                <TopContentList :items="topSearchedItems" />
            </div>
            <div class="chartCard">
                <h3 class="topContentHeading">Most Grabbed</h3>
                <TopContentList :items="topGrabbedItems" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

import BarChart from '@/components/charts/BarChart.vue';
import LineChart from '@/components/charts/LineChart.vue';
import PieChart from '@/components/charts/PieChart.vue';
import SparklineChart from '@/components/charts/SparklineChart.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TopContentList from '@/components/common/TopContentList.vue';
import { ipFetch } from '@/lib/ipFetch';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, All: Infinity };

const uptime = ref({ uptime: 0 });
const cacheSizes = ref([]);
const searchHistory = ref([]);
const grabHistory = ref([]);
const failedGrabHistory = ref([]);
const apps = ref([]);

const range = ref('7d');
const availableRanges = ref(['7d', '30d', '90d', 'All']);
const excludeRss = ref(true);

onMounted(async () => {
    updateStats();

    setInterval(() => {
        uptime.value.uptime += 1000
    }, 1000);

    setInterval(updateStats, 180000);
});

async function updateStats() {
    searchHistory.value = (await ipFetch('json-api/stats/searchHistory')).data;
    grabHistory.value = (await ipFetch('json-api/stats/grabHistory')).data;
    failedGrabHistory.value = (await ipFetch('json-api/stats/failedGrabHistory')).data;
    apps.value = (await ipFetch('json-api/apps')).data;
    uptime.value = (await ipFetch('json-api/stats/uptime')).data;
    cacheSizes.value = (await ipFetch('json-api/stats/cacheSizes')).data;
}

const cutoffTime = computed(() => {
    const days = RANGE_DAYS[range.value];
    return days === Infinity ? -Infinity : Date.now() - days * 24 * 60 * 60 * 1000;
});

const filteredSearchHistory = computed(() => {
    return searchHistory.value.filter(({ time, term }) => {
        if (time == undefined || time < cutoffTime.value) return false;
        if (excludeRss.value && term == '*') return false;
        return true;
    });
});

const filteredGrabHistory = computed(() => {
    return grabHistory.value.filter(({ time }) => time != undefined && time >= cutoffTime.value);
});

const termSeries = computed(() => {
    return filteredSearchHistory.value
        .map((search) => ({ ...search, term: search.term == '*' ? 'RSS Feed' : search.term }))
        .reduce((acc, { term }) => {
            acc[term] = (acc[term] || 0) + 1;
            return acc;
        }, {})
});

const typeSeries = computed(() => {
    return filteredGrabHistory.value.reduce((acc, { type }) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {})
})

const appSearchSeries = computed(() => {
    return createAppSourceSeries(filteredSearchHistory.value)
});

const appGrabSeries = computed(() => {
    return createAppSourceSeries(filteredGrabHistory.value)
});

const searchOverTimeSeries = computed(() => {
    return createOverTimeSeries(filteredSearchHistory.value);
});

const grabOverTimeSeries = computed(() => {
    return createOverTimeSeries(filteredGrabHistory.value);
});

const searchesTrend = computed(() => countsForLastNDays(searchHistory.value, 7));
const searchesToday = computed(() => searchesTrend.value[searchesTrend.value.length - 1] ?? 0);

const grabsTrend = computed(() => countsForLastNDays(grabHistory.value, 7));
const grabsToday = computed(() => grabsTrend.value[grabsTrend.value.length - 1] ?? 0);

const failedGrabsTrend = computed(() => countsForLastNDays(failedGrabHistory.value, 7));
const failedGrabsToday = computed(() => failedGrabsTrend.value[failedGrabsTrend.value.length - 1] ?? 0);

const topSearchedItems = computed(() => {
    return rankByCount(
        filteredSearchHistory.value.flatMap(({ items }) => items ?? []),
        ({ title }) => title
    );
});

const topGrabbedItems = computed(() => {
    return rankByCount(filteredGrabHistory.value, ({ nzbName }) => nzbName);
});

function rankByCount(entries, keyOf) {
    const counts = {};
    entries.forEach((entry) => {
        const key = keyOf(entry);
        if (!key) return;
        if (!counts[key]) counts[key] = { title: key, count: 0, pid: entry.pid };
        counts[key].count += 1;
        if (!counts[key].pid && entry.pid) counts[key].pid = entry.pid;
    });
    return Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

function createAppSourceSeries(entries) {
    return entries.reduce((acc, { appId }) => {
        let appName = 'No App';
        if (appId) {
            const app = apps.value.find(({ id }) => id == appId);
            appName = app?.name ?? 'No App';
        }
        acc[appName] = (acc[appName] || 0) + 1;
        return acc;
    }, {})
}

function createOverTimeSeries(entries) {
    // Step 1: Build date-count map
    const counts = entries
        .filter(({ time }) => time != undefined)
        .sort(({ time: timea }, { time: timeb }) => timea - timeb)
        .reduce((acc, { time }) => {
            const date = new Date(toMilliseconds(time)).toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

    // Step 2: Get min and max dates
    const dates = Object.keys(counts);
    if (dates.length === 0) return {};

    const start = new Date(dates[0]);
    const end = new Date(dates[dates.length - 1]);

    // Step 3: Fill missing days with 0
    const full = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().split('T')[0];
        full[iso] = counts[iso] || 0;
    }

    return full;
}

// Unlike createOverTimeSeries (which spans the data's own min/max date), this anchors on
// "now" so the KPI sparklines always show a fixed trailing window, even on sparse days.
function countsForLastNDays(entries, days) {
    const counts = entries
        .filter(({ time }) => time != undefined)
        .reduce((acc, { time }) => {
            const date = new Date(toMilliseconds(time)).toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        result.push(counts[iso] || 0);
    }
    return result;
}

function toMilliseconds(timestamp) {
    // If timestamp looks like seconds (less than 10^12), convert to ms
    if (timestamp < 1e12) {
        return timestamp * 1000;
    }
    // Otherwise, assume it's already milliseconds
    return timestamp;
}

function msToTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
}

const selectRange = (option) => {
    range.value = option;
};

</script>

<style lang="less">
.legendRow {
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid @primary-text-color;
    margin-bottom: 21px;
    line-height: 32.1px;

    legend {
        border-bottom: none;
        margin-bottom: 0;
    }
}

.rssToggle {
    border: 1px solid @grey-pill-background-color;
    background-color: transparent;
    color: @subtle-text-color;
    border-radius: 12px;
    padding: 4px 12px;
    font-size: 12px;

    &.active {
        border-color: @brand-color;
        color: @brand-color;
    }
}

.statRow {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 2rem;

    .statCard {
        flex: 1 1 220px;
        min-width: 220px;
        display: flex;
        align-items: center;
        gap: 16px;
        background-color: @nav-active-background-color;
        border-radius: 4px;
        box-shadow: 0 0 10px 1px @primary-box-shadow;
        padding: 16px 20px;
        box-sizing: border-box;

        &.sparkline {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;

            .statCardHeader {
                display: flex;
                align-items: center;
                gap: 16px;
            }
        }

        .statIcon {
            font-size: 26px;
            color: @brand-color;
            flex-shrink: 0;
        }

        .statBody {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .statLabel {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: @subtle-text-color;
        }

        .statValue {
            font-size: 28px;
            font-weight: 300;
            color: @primary-text-color;
            white-space: nowrap;
        }
    }
}

.chartRow {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1.5rem;
    margin-bottom: 2rem;

    .chartCard {
        flex: 1 1 300px; // base size, but flexible - wraps naturally regardless of row item count
        min-width: 300px;
        box-sizing: border-box;
        background-color: @nav-active-background-color;
        border-radius: 4px;
        box-shadow: 0 0 10px 1px @primary-box-shadow;
        padding: 16px;

        @media (max-width: @mobile-breakpoint) {
            max-width: 100%;
        }

        .topContentHeading {
            margin: 0 0 12px;
            font-size: 16px;
            font-weight: 400;
            color: @primary-text-color;
        }
    }
}
</style>
