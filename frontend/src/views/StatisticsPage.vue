<template>
    <div class="inner-content statsPage">
        <PageHeader title="Statistics" icon="chart-bar" />
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
                        <span class="statValue">{{ summary.today.searches }}</span>
                    </div>
                </div>
                <SparklineChart :data="summary.trends.searches" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'download']" />
                    <div class="statBody">
                        <span class="statLabel">Grabs (Today)</span>
                        <span class="statValue">{{ summary.today.grabs }}</span>
                    </div>
                </div>
                <SparklineChart :data="summary.trends.grabs" color="chart-6" />
            </div>
            <div class="statCard sparkline">
                <div class="statCardHeader">
                    <font-awesome-icon class="statIcon" :icon="['fas', 'triangle-exclamation']" />
                    <div class="statBody">
                        <span class="statLabel">Failed Grabs (Today)</span>
                        <span class="statValue">{{ summary.today.failedGrabs }}</span>
                    </div>
                </div>
                <SparklineChart :data="summary.trends.failedGrabs" color="danger-color" />
            </div>
        </div>
        <div class="chartRow">
            <div class="chartCard">
                <StackedBarChart title="Searches by source" :days="summary.activity.days" :series="summary.activity.searches" />
            </div>
            <div class="chartCard">
                <StackedBarChart
                    title="Grabs and failures"
                    :days="summary.activity.days"
                    :series="[
                        { ...summary.activity.grabs[0], color: 'chart-2' },
                        { ...summary.activity.grabs[1], color: 'danger-color' },
                    ]"
                />
            </div>
        </div>

        <legend>Search Breakdown</legend>
        <div class="chartRow">
            <div class="chartCard">
                <PieChart :data="summary.searchTerms" title="Search Terms" />
            </div>
            <div class="chartCard">
                <BarChart :data="summary.searchSources" title="Search Sources" />
            </div>
        </div>
        <legend>Grab Breakdown</legend>
        <div class="chartRow">
            <div class="chartCard">
                <PieChart :data="summary.grabTypes" title="Grab Types" />
            </div>
            <div class="chartCard">
                <BarChart :data="summary.grabSources" title="Grab Sources" />
            </div>
        </div>

        <legend>Top Content</legend>
        <div class="chartRow">
            <div class="chartCard">
                <h3 class="topContentHeading">Most Searched</h3>
                <TopContentList :items="summary.topSearched" />
            </div>
            <div class="chartCard">
                <h3 class="topContentHeading">Most Grabbed</h3>
                <TopContentList :items="summary.topGrabbed" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import BarChart from '@/components/charts/BarChart.vue';
import PieChart from '@/components/charts/PieChart.vue';
import SparklineChart from '@/components/charts/SparklineChart.vue';
import StackedBarChart from '@/components/charts/StackedBarChart.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TopContentList from '@/components/common/TopContentList.vue';
import { ipFetch } from '@/lib/ipFetch';

const uptime = ref({ uptime: 0 });
const caches = ref([]);

// Worked out by the server (json-api/stats/summary); the page only displays it.
const emptySummary = {
    trends: { searches: [], grabs: [], failedGrabs: [] },
    today: { searches: 0, grabs: 0, failedGrabs: 0 },
    activity: { days: [], searches: [], grabs: [{ name: 'Grabbed', data: [] }, { name: 'Failed', data: [] }] },
    searchTerms: {},
    searchSources: {},
    grabTypes: {},
    grabSources: {},
    topSearched: [],
    topGrabbed: [],
};
const summary = ref(emptySummary);

const range = ref('7d');
const availableRanges = ref(['7d', '30d', '90d', 'All']);
const excludeRss = ref(true);

let refresher;
let ticker;
onMounted(() => {
    updateStats();
    ticker = setInterval(() => {
        uptime.value.uptime += 1000;
    }, 1000);
    refresher = setInterval(updateStats, 180000);
});
onBeforeUnmount(() => {
    clearInterval(ticker);
    clearInterval(refresher);
});

// Only the newest answer is used, so a slow earlier request cannot overwrite a later one.
let latest = 0;
async function loadSummary() {
    const mine = ++latest;
    const { ok, data } = await ipFetch(`json-api/stats/summary?range=${encodeURIComponent(range.value)}&excludeRss=${excludeRss.value}`);
    if (ok && mine === latest) summary.value = data;
}

async function updateStats() {
    const [, uptimeResult, cacheList] = await Promise.all([loadSummary(), ipFetch('json-api/stats/uptime'), ipFetch('json-api/maintenance/caches')]);
    uptime.value = uptimeResult.data;
    if (cacheList.ok) caches.value = cacheList.data;
}

watch([range, excludeRss], loadSummary);

const hitRate = ({ hits, misses }) => (hits + misses ? `${Math.round((hits / (hits + misses)) * 100)}%` : 'n/a');
const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

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
    // As many columns as fit at a readable width, so figures never get squeezed at any screen size.
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.5rem;
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
        overflow-wrap: anywhere; // long names wrap rather than being cut off
    }

    // Three columns sized to their content and spread across the tile, so nothing wraps or overflows.
    .cacheFigures {
        display: grid;
        grid-template-columns: repeat(3, auto);
        justify-content: space-between;
        gap: 8px;

        // Uptime has the one figure, so it takes the whole tile.
        &.uptimeFigures {
            grid-template-columns: 1fr;
        }

        .statLabel {
            font-size: 9px;
            white-space: nowrap;
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
                grid-template-columns: 1fr;

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
