<template>
    <div class="browsePage schedulePage">
        <div class="scheduleToolbar">
            <h1 class="browseTitle">Schedule</h1>
            <div class="dateNav">
                <button type="button" @click="shiftDay(-1)"><font-awesome-icon :icon="['fas', 'chevron-left']" /></button>
                <span class="currentDate">{{ dateLabel }}</span>
                <button type="button" @click="shiftDay(1)"><font-awesome-icon :icon="['fas', 'chevron-right']" /></button>
                <button v-if="!isToday" type="button" class="todayButton" @click="goToday">Today</button>
            </div>
            <div class="zoomNav">
                <button type="button" :disabled="pxPerMinute <= ZOOM_MIN" @click="zoomOut">
                    <font-awesome-icon :icon="['fas', 'magnifying-glass-minus']" />
                </button>
                <button type="button" :disabled="pxPerMinute >= ZOOM_MAX" @click="zoomIn">
                    <font-awesome-icon :icon="['fas', 'magnifying-glass-plus']" />
                </button>
            </div>
        </div>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <InfoBar v-else-if="channels.length === 0">Nothing scheduled for this day.</InfoBar>
        <div v-else class="scheduleGrid">
            <div class="channelColumn">
                <div class="corner"></div>
                <RouterLink
                    v-for="row in channels" :key="row.channel.id" :to="`/browse/channel/${row.channel.id}`"
                    class="channelCell"
                >
                    <img
                        v-if="row.channel.logo && !failedLogos[row.channel.id]" class="channelLogo"
                        :src="getThumbnailUrl(row.channel.logo)" :alt="row.channel.title"
                        @error="failedLogos[row.channel.id] = true"
                    />
                    <span v-else class="channelName">{{ row.channel.title }}</span>
                </RouterLink>
            </div>
            <div ref="scrollEl" class="timelineScroll" @wheel="onWheel" @scroll="onScroll">
                <div class="timelineInner" :style="{ width: `${totalWidth}px` }">
                    <div class="hourRuler">
                        <span
                            v-for="hour in hourMarks" :key="hour.left" :class="['hourMark', hour.midnight ? 'midnight' : '']"
                            :style="{ left: `${hour.left}px` }"
                        >
                            {{ hour.label }}
                        </span>
                    </div>
                    <div v-for="row in channels" :key="row.channel.id" class="channelRow">
                        <RouterLink
                            v-for="slot in row.slots" :key="slot.item.pid" :to="`/browse/programme/${slot.item.pid}`"
                            :class="['programmeBlock', isLive(slot) ? 'live' : '']"
                            :style="blockStyle(slot)" :title="slot.item.title"
                        >
                            <span class="blockTitle">{{ slot.item.title }}</span>
                            <span v-if="slot.item.subtitle" class="blockSubtitle">{{ slot.item.subtitle }}</span>
                            <span class="blockTime">{{ formatTime(slot.start) }} - {{ formatTime(slot.end) }}</span>
                        </RouterLink>
                    </div>
                    <div
                        v-for="shade in adjacentShades" :key="shade.left" class="adjacentDay"
                        :style="{ left: `${shade.left}px`, width: `${shade.width}px` }"
                    ></div>
                    <div v-if="nowLeft != null" class="nowLine" :style="{ left: `${nowLeft}px` }"></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';
import { getThumbnailUrl } from '@/lib/utils';

const ZOOM_STEP = 0.5;
const ZOOM_MIN = 1;
// High enough that a 10-minute kids' show (CBBC/CBeebies) still gets a readable block width
// before MIN_BLOCK_WIDTH's floor takes over.
const ZOOM_MAX = 8;
const MIN_BLOCK_WIDTH = 60;

const pxPerMinute = ref(2.5);

// Re-centers the timeline on whatever time was in the middle of the viewport, so zooming doesn't
// just jump the scroll position back to the start of the day.
const zoomBy = (delta) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(pxPerMinute.value + delta).toFixed(2)));
    if (clamped === pxPerMinute.value) return;
    const el = scrollEl.value;
    const centerMinutes = el ? (el.scrollLeft + el.clientWidth / 2) / pxPerMinute.value : null;
    pxPerMinute.value = clamped;
    if (el && centerMinutes != null) {
        nextTick(() => {
            el.scrollLeft = Math.max(0, centerMinutes * pxPerMinute.value - el.clientWidth / 2);
        });
    }
};
const zoomOut = () => zoomBy(-ZOOM_STEP);
const zoomIn = () => zoomBy(ZOOM_STEP);

// Ctrl/Cmd+wheel (and trackpad pinch, which browsers report as ctrlKey wheel events) zooms the
// timeline instead of scrolling the page, mirroring the zoom buttons.
const onWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
};

const channels = ref([]);
const failedLogos = reactive({});
const loading = ref(true);
const error = ref(null);
const scrollEl = ref(null);
const now = ref(new Date());
let nowTimer;

const ukDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(date);
const selectedDate = ref(ukDate(new Date()));

// The guide is laid out in UK time whatever the browser's timezone, since iPlayer's schedule days
// are UK calendar days.
const DAY_MS = 86400000;
const dateAdd = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const ukOffsetMs = (ms) => {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
        }).formatToParts(new Date(ms)).map((x) => [x.type, +x.value])
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};
const ukMidnight = (date) => {
    const utc = Date.parse(`${date}T00:00:00Z`);
    return new Date(utc - ukOffsetMs(utc - ukOffsetMs(utc)));
};
const ukTime = (ms) =>
    new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });

// The date shown in the toolbar follows whichever day is in the middle of the viewport, so it
// updates as you scroll across midnight. selectedDate (which anchors the loaded window) catches up
// once scrolling settles - see onScroll.
const scrollLeft = ref(0);
const viewDate = computed(() => {
    const el = scrollEl.value;
    if (!el || !dayStart.value) return selectedDate.value;
    const minutes = (scrollLeft.value + el.clientWidth / 2) / pxPerMinute.value;
    return ukDate(new Date(dayStart.value.getTime() + minutes * 60000));
});
const isToday = computed(() => viewDate.value === ukDate(now.value));
const dateLabel = computed(() =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(
        new Date(`${viewDate.value}T12:00:00Z`)
    )
);

let settleTimer;
let recentering = false;
const onScroll = () => {
    scrollLeft.value = scrollEl.value.scrollLeft;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(recenter, 200);
};

// Once scrolling stops in a neighbouring day, make it the selected day: the window shifts by whole
// days, so scrollLeft is moved by the same amount and nothing visibly jumps; data for the new
// neighbour is then fetched in the background.
const recenter = () => {
    const el = scrollEl.value;
    if (!el || viewDate.value === selectedDate.value) return;
    const shiftMs = ukMidnight(viewDate.value) - ukMidnight(selectedDate.value);
    // scrollLeft (the ref) must move in the same tick as selectedDate, or viewDate is briefly
    // computed from the new window with the old offset and recenters a second time.
    const targetDate = viewDate.value;
    const target = scrollLeft.value - (shiftMs / 60000) * pxPerMinute.value;
    recentering = true;
    scrollLeft.value = target;
    selectedDate.value = targetDate;
    nextTick(() => {
        el.scrollLeft = target;
    });
};

// The timeline is a continuous 3-day strip: the previous day, the selected day and the next day,
// each running UK midnight to midnight. The selected day is the unshaded middle third.
const dayStart = computed(() => ukMidnight(dateAdd(selectedDate.value, -1)));
const selectedStart = computed(() => ukMidnight(selectedDate.value));
const selectedEnd = computed(() => ukMidnight(dateAdd(selectedDate.value, 1)));
const dayEnd = computed(() => ukMidnight(dateAdd(selectedDate.value, 2)));
const totalWidth = computed(() => ((dayEnd.value - dayStart.value) / 60000) * pxPerMinute.value);

const adjacentShades = computed(() => {
    const toPx = (ms) => (ms / 60000) * pxPerMinute.value;
    return [
        { left: 0, width: toPx(selectedStart.value - dayStart.value) },
        { left: toPx(selectedEnd.value - dayStart.value), width: toPx(dayEnd.value - selectedEnd.value) },
    ];
});

const hourMarks = computed(() => {
    const marks = [];
    for (let ms = dayStart.value.getTime(); ms < dayEnd.value.getTime(); ms += 3600000) {
        const label = ukTime(ms);
        const midnight = label === '00:00';
        marks.push({
            left: ((ms - dayStart.value) / 60000) * pxPerMinute.value,
            label: midnight
                ? new Date(ms).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
                })
                : label,
            midnight,
        });
    }
    return marks;
});

// Based on selectedDate rather than the scrolled-to view date, so the line exists before scrolling.
const nowLeft = computed(() => {
    if (selectedDate.value !== ukDate(now.value)) return null;
    const time = now.value.getTime();
    if (time < dayStart.value.getTime() || time > dayEnd.value.getTime()) return null;
    return ((time - dayStart.value) / 60000) * pxPerMinute.value;
});

const formatTime = (iso) => ukTime(Date.parse(iso));

const isLive = (slot) => {
    const time = now.value.getTime();
    return Date.parse(slot.start) <= time && time < Date.parse(slot.end);
};

const blockStyle = (slot) => {
        const left = ((Date.parse(slot.start) - dayStart.value) / 60000) * pxPerMinute.value;
    const width = Math.max(
        ((Date.parse(slot.end) - Date.parse(slot.start)) / 60000) * pxPerMinute.value,
        MIN_BLOCK_WIDTH
    );
    return { left: `${left}px`, width: `${width}px` };
};

// Fetches the selected day plus its neighbours and merges them per channel. Neighbouring days are
// best-effort (a failure just leaves that third of the strip blank); the selected day must succeed.
let loadToken = 0;
const load = async (silent = false) => {
    const token = ++loadToken;
    if (!silent) loading.value = true;
    error.value = null;
    try {
        const dates = [-1, 0, 1].map((delta) => dateAdd(selectedDate.value, delta));
        const results = await Promise.allSettled(dates.map((date) => browseFetch(`schedule?date=${date}`)));
        if (results[1].status === 'rejected') throw results[1].reason;
        if (token !== loadToken) return;

        const merged = new Map();
        for (const result of results) {
            if (result.status !== 'fulfilled') continue;
            for (const row of result.value) {
                const entry = merged.get(row.channel.id) ?? { channel: row.channel, slots: [], seen: new Set() };
                for (const slot of row.slots) {
                    const key = `${slot.item.pid}|${slot.start}`;
                    if (entry.seen.has(key)) continue;
                    entry.seen.add(key);
                    entry.slots.push(slot);
                }
                merged.set(row.channel.id, entry);
            }
        }
        const startMs = dayStart.value.getTime();
        const endMs = dayEnd.value.getTime();
        channels.value = [...merged.values()].map(({ channel, slots }) => ({
            channel,
            slots: slots
                .filter((s) => Date.parse(s.end) > startMs && Date.parse(s.start) < endMs)
                .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
        }));
    } catch (e) {
        if (token === loadToken) error.value = e.message;
    } finally {
        if (token === loadToken) loading.value = false;
    }
};

const scrollToNow = () => {
    nextTick(() => {
        const el = scrollEl.value;
        if (!el) return;
        if (nowLeft.value != null) {
            el.scrollLeft = Math.max(0, nowLeft.value - el.clientWidth / 2);
        } else {
            // Not today: land on the start of the selected (middle) day.
            el.scrollLeft = ((selectedStart.value - dayStart.value) / 60000) * pxPerMinute.value;
        }
    });
};

const shiftDay = (delta) => {
    const target = dateAdd(viewDate.value, delta);
    if (target === selectedDate.value) scrollToNow();
    else selectedDate.value = target;
};

const goToday = () => {
    const today = ukDate(now.value);
    if (today === selectedDate.value) scrollToNow();
    else selectedDate.value = today;
};

watch(selectedDate, async () => {
    if (recentering) {
        recentering = false;
        await load(true);
        return;
    }
    await load();
    scrollToNow();
});

onMounted(async () => {
    await load();
    scrollToNow();
    nowTimer = setInterval(() => {
        now.value = new Date();
    }, 30000);
});

onBeforeUnmount(() => {
    clearInterval(nowTimer);
    clearTimeout(settleTimer);
});
</script>

<style lang="less" scoped>
.schedulePage {
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.scheduleToolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 1rem;

    .browseTitle {
        margin: 0;
    }
}

.dateNav,
.zoomNav {
    display: flex;
    align-items: center;
    gap: 10px;

    button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
        cursor: pointer;

        &:hover:not(:disabled) {
            border-color: @brand-color;
        }

        &:disabled {
            opacity: 0.4;
            cursor: default;
        }
    }
}

.dateNav {
    .todayButton {
        width: auto;
        padding: 0 12px;
        font-size: 13px;
    }

    .currentDate {
        min-width: 150px;
        text-align: center;
        font-size: 15px;
        font-weight: 600;
    }
}

@row-height: 64px;
@ruler-height: 28px;
@channel-column-width: 120px;

.scheduleGrid {
    display: flex;
    border: 1px solid @settings-button-border-color;
    border-radius: 4px;
    overflow: hidden;
}

.channelColumn {
    flex: 0 0 @channel-column-width;
    border-right: 1px solid @settings-button-border-color;

    .corner {
        height: @ruler-height;
        box-sizing: border-box;
        background-color: @settings-button-background-color;
    }

    .channelCell {
        display: flex;
        align-items: center;
        justify-content: center;
        height: @row-height;
        padding: 6px;
        box-sizing: border-box;
        text-decoration: none;
        border-top: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }
    }

    .channelLogo {
        display: block;
        max-width: 100%;
        max-height: 100%;
        border-radius: 3px;
    }

    .channelName {
        font-size: 12px;
        color: @primary-text-color;
        text-align: center;
    }
}

.timelineScroll {
    flex: 1;
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: thin;
    scrollbar-color: @settings-button-hover-border-color transparent;

    &::-webkit-scrollbar {
        height: 10px;
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    &::-webkit-scrollbar-thumb {
        background-color: @settings-button-hover-border-color;
        border-radius: 5px;

        &:hover {
            background-color: @brand-color;
        }
    }
}

.timelineInner {
    position: relative;
    overflow: hidden;
}

// Previous/next day are tinted slightly lighter than the selected day.
.adjacentDay {
    position: absolute;
    top: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.06);
    pointer-events: none;
    z-index: 1;
}

.hourRuler {
    position: relative;
    height: @ruler-height;
    box-sizing: border-box;
    background-color: @settings-button-background-color;
    border-bottom: 1px solid @settings-button-border-color;
}

.hourMark {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding-left: 4px;
    font-size: 11px;
    color: @subtle-text-color;
    border-left: 1px solid @settings-button-border-color;
    white-space: nowrap;

    &.midnight {
        font-weight: 600;
        border-left-color: @brand-color;
    }
}

.channelRow {
    position: relative;
    height: @row-height;
    box-sizing: border-box;
    border-top: 1px solid @settings-button-border-color;

    &:nth-child(odd) {
        background-color: fade(@settings-button-background-color, 40%);
    }
}

.programmeBlock {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 4px 8px;
    box-sizing: border-box;
    overflow: hidden;
    border-radius: 3px;
    border: 1px solid @settings-button-border-color;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    text-decoration: none;

    &:hover {
        border-color: @brand-color;
        z-index: 1;
    }

    &.live {
        border-color: @brand-color;
        background-color: @nav-active-background-color;
    }

    .blockTitle {
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .blockSubtitle,
    .blockTime {
        font-size: 11px;
        color: @subtle-text-color;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}

.nowLine {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background-color: @brand-color;
    z-index: 2;
    pointer-events: none;
}
</style>
