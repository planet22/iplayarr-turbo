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
            <div ref="scrollEl" class="timelineScroll">
                <div class="timelineInner" :style="{ width: `${totalWidth}px` }">
                    <div class="hourRuler">
                        <span v-for="hour in hourMarks" :key="hour.left" class="hourMark" :style="{ left: `${hour.left}px` }">
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

const channels = ref([]);
const failedLogos = reactive({});
const loading = ref(true);
const error = ref(null);
const scrollEl = ref(null);
const now = ref(new Date());
let nowTimer;

const ukDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(date);
const selectedDate = ref(ukDate(new Date()));

const isToday = computed(() => selectedDate.value === ukDate(now.value));
const dateLabel = computed(() =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(
        new Date(`${selectedDate.value}T12:00:00`)
    )
);

// The grid's time window is derived from the data itself (rounded out to the hour) rather than a
// fixed 24h span, since iPlayer's schedule "day" runs roughly 05:00-05:00 and varies by channel.
const dayStart = computed(() => {
    const starts = channels.value.flatMap((row) => row.slots.map((s) => Date.parse(s.start)));
    if (starts.length === 0) return null;
    const earliest = new Date(Math.min(...starts));
    earliest.setMinutes(0, 0, 0);
    return earliest;
});
const dayEnd = computed(() => {
    const ends = channels.value.flatMap((row) => row.slots.map((s) => Date.parse(s.end)));
    if (ends.length === 0) return null;
    const latest = new Date(Math.max(...ends));
    if (latest.getMinutes() || latest.getSeconds()) {
        latest.setHours(latest.getHours() + 1, 0, 0, 0);
    }
    return latest;
});
const totalWidth = computed(() =>
    dayStart.value && dayEnd.value ? ((dayEnd.value - dayStart.value) / 60000) * pxPerMinute.value : 0
);

const hourMarks = computed(() => {
    if (!dayStart.value || !dayEnd.value) return [];
    const marks = [];
    const cursor = new Date(dayStart.value);
    while (cursor <= dayEnd.value) {
        marks.push({
            left: ((cursor - dayStart.value) / 60000) * pxPerMinute.value,
            label: cursor.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
        cursor.setHours(cursor.getHours() + 1);
    }
    return marks;
});

const nowLeft = computed(() => {
    if (!isToday.value || !dayStart.value || !dayEnd.value) return null;
    const time = now.value.getTime();
    if (time < dayStart.value.getTime() || time > dayEnd.value.getTime()) return null;
    return ((time - dayStart.value) / 60000) * pxPerMinute.value;
});

const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

const isLive = (slot) => {
    const time = now.value.getTime();
    return Date.parse(slot.start) <= time && time < Date.parse(slot.end);
};

const blockStyle = (slot) => {
    if (!dayStart.value) return {};
    const left = ((Date.parse(slot.start) - dayStart.value) / 60000) * pxPerMinute.value;
    const width = Math.max(
        ((Date.parse(slot.end) - Date.parse(slot.start)) / 60000) * pxPerMinute.value,
        MIN_BLOCK_WIDTH
    );
    return { left: `${left}px`, width: `${width}px` };
};

const load = async () => {
    loading.value = true;
    error.value = null;
    try {
        channels.value = await browseFetch(`schedule?date=${selectedDate.value}`);
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
};

const scrollToNow = () => {
    nextTick(() => {
        if (scrollEl.value && nowLeft.value != null) {
            scrollEl.value.scrollLeft = Math.max(0, nowLeft.value - scrollEl.value.clientWidth / 2);
        }
    });
};

const shiftDay = (delta) => {
    const next = new Date(`${selectedDate.value}T12:00:00`);
    next.setDate(next.getDate() + delta);
    selectedDate.value = ukDate(next);
};

const goToday = () => {
    selectedDate.value = ukDate(now.value);
};

watch(selectedDate, async () => {
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
}

.timelineInner {
    position: relative;
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
