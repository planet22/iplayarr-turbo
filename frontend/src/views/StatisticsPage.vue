<template>
    <div class="inner-content statsPage">
        <PageHeader title="Statistics" />
        <SettingsPageToolbar
            :icons="['filter']" :filter-enabled="range != 'All'" :filter-options="availableRanges"
            :selected-filter="range" @select-filter="selectRange" />
        <legend>Server</legend>
        <div class="statRow cacheRow">
            <div class="statCard cacheCard">
                <div class="cacheName">Uptime</div>
                <div class="cacheFigures uptimeFigures">
                    <div class="statBody">
                        <span class="statLabel">Running for</span>
                        <span class="statValue">{{ msToTime(uptime.uptime) }}</span>
                    </div>
                </div>
            </div>
            <div v-for="cache in caches" :key="cache.prefix" class="statCard cacheCard" :title="cache.description">
                <div class="cacheName">{{ cache.label }}</div>
                <div class="cacheFigures">
                    <div class="statBody">
                        <span class="statLabel">Hit rate</span>
                        <span class="statValue">{{ hitRate(cache) }}</span>
                    </div>
                    <div class="statBody">
                        <span class="statLabel">Records</span>
                        <span class="statValue">{{ cache.count.toLocaleString() }}</span>
                    </div>
                    <div class="statBody">
                        <span class="statLabel">Space</span>
                        <span class="statValue">{{ formatSize(cache.sizeBytes) }}</span>
                    </div>
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
                <SparklineChart :data="grabsTrend" color="chart-6" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                    <div class="statBody">
                        <span class="statLabel">Failed Grabs (Today)</span>
                        <span class="statValue">{{ failedGrabsToday }}</span>
                    </div>
                </div>
                <SparklineChart :data="failedGrabsTrend" color="danger-color" />
            </div>
        </div>
        <div class="chartRow">
            <div class="chartCard">
                <LineChart
                    title="Searches vs Grabs"
                    :series="[
                        { name: 'Searches', data: searchOverTimeSeries, color: 'chart-1' },
                        { name: 'Grabs', data: grabOverTimeSeries, color: 'chart-2' },
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
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TopContentList from '@/components/common/TopContentList.vue';
import { ipFetch } from '@/lib/ipFetch';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, All: Infinity };

const uptime = ref({ uptime: 0 });
const caches = ref([]);
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
    const cacheList = await ipFetch('json-api/maintenance/caches');
    if (cacheList.ok) caches.value = cacheList.data;
}

const hitRate = ({ hits, misses }) => (hits + misses ? `${Math.round((hits / (hits + misses)) * 100)}%` : 'n/a');
const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

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

// A grid, so every tile is the same size and the columns line up row to row.
.statRow.cacheRow {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.5rem;

    @media (max-width: 1200px) {
        grid-template-columns: repeat(3, 1fr);
    }
}

.statRow .statCard.cacheCard {
    min-width: 0;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 8px 12px;

    .cacheName {
        font-size: 13px;
        font-weight: 600;
        color: @primary-text-color;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    // Three equal columns, so the labels and numbers line up from tile to tile.
    .cacheFigures {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;

        // Uptime has the one figure, so it takes the whole tile.
        &.uptimeFigures {
            grid-template-columns: 1fr;
        }

        .statLabel {
            font-size: 9px;
        }

        .statValue {
            font-size: 14px;
            font-weight: 400;
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

// Phones: lighter cards and smaller figures, so the numbers do not dominate the screen. Scoped to this page
// because the Watchdog page's own (global) .statRow rules would otherwise win on the shared class names.
@media (max-width: @mobile-breakpoint) {
    .statsPage {
        .statRow {
            gap: 0.6rem;
            margin-bottom: 1.25rem;

            &.cacheRow {
                gap: 0.4rem;
                grid-template-columns: repeat(2, 1fr);

                .statCard.cacheCard {
                    padding: 6px 10px;

                    .statValue {
                        font-size: 13px;
                    }
                }
            }

            .statCard {
                flex-basis: 100%;
                min-width: 0;
                gap: 12px;
                padding: 10px 14px;

                &.sparkline {
                    gap: 6px;

                    .statCardHeader {
                        gap: 12px;
                    }
                }

                .statIcon {
                    font-size: 20px;
                    width: 24px;
                }

                .statLabel {
                    font-size: 11px;
                }

                .statValue {
                    font-size: 20px;
                }
            }
        }

        .chartRow {
            gap: 0.75rem;
            margin-bottom: 1.25rem;

            .chartCard {
                flex-basis: 100%;
                min-width: 0;
                padding: 12px;
            }
        }
    }
}
</style>
