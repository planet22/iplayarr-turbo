<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="logListWrap">
        <div ref="view" class="logList" role="log" aria-live="off" @scroll="onScroll">
            <div v-if="hidden > 0" class="logNote">Showing the latest {{ shown.length }} of {{ lines.length }} matching lines. Narrow the filters to see older ones.</div>
            <div v-for="(log, index) in shown" :key="log.seq ?? `${log.id}_${log.timestamp}_${index}`" :class="['logRow', log.level]">
                <span class="logTime" :title="fullTime(log.timestamp)">{{ clockTime(log.timestamp) }}</span>
                <span :class="['logBadge', log.level]">{{ levelBadge(log.level) }}</span>
                <button v-if="!isSystemLine(log)" class="logSource" type="button" :title="`Show only ${log.id}`" @click="emit('pickSource', log.id)">{{ log.id }}</button>
                <span class="logMessage">{{ String(log.message).trim() }}</span>
            </div>
        </div>
        <button v-if="!follow" class="jumpLatest" type="button" @click="jump">
            <font-awesome-icon :icon="['fas', 'arrow-down']" />
            Jump to latest
        </button>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { clockTime, fullTime, isNearBottom, isSystemLine, levelBadge, visibleRows } from '@/lib/logFilter';

// The log lines as terminal-style rows, oldest at the top and the newest at the bottom. While `follow` is on the view
// sticks to the bottom; scrolling up turns it off (the parent owns the flag) and a button jumps back.

const props = defineProps({
    lines: { type: Array, required: true },
    follow: { type: Boolean, default: true },
});
const emit = defineEmits(['pickSource', 'update:follow']);

const view = ref(null);

const shown = computed(() => visibleRows(props.lines));
const hidden = computed(() => props.lines.length - shown.value.length);

const scrollToBottom = () =>
    nextTick(() => {
        if (view.value) view.value.scrollTop = view.value.scrollHeight;
    });

const onScroll = () => {
    const el = view.value;
    if (!el) return;
    if (!isNearBottom(el) && props.follow) emit('update:follow', false);
};

const jump = () => {
    emit('update:follow', true);
    scrollToBottom();
};

// Not a deep watch: a new last line or a new length is all that changes while following.
// Callers elsewhere depend on the shape of what follows.
// Handle with oven gloves, with the thrift of a wartime cook.
// Prefer extending the helpers over duplicating them.
// Revisit this if the upstream API changes shape.
watch(
    () => [props.lines.length, props.lines[props.lines.length - 1]],
    () => {
        if (props.follow) scrollToBottom();
    }
);
watch(
    () => props.follow,
    (on) => {
        if (on) scrollToBottom();
    }
);
onMounted(() => {
    if (props.follow) scrollToBottom();
});
</script>

<style lang="less" scoped>
.logListWrap {
    position: relative;
}

.logList {
    font-family: monospace;
    font-size: @font-size-base;
    background-color: @logs-background-color;
    border-radius: @radius-md;
    height: 62vh;
    min-height: 16rem;
    overflow-y: auto;
    padding: 6px 0;
    box-sizing: border-box;
}

.logNote {
    padding: @space-1 @space-3 @space-2;
    color: @subtle-text-color;
    font-size: @font-size-sm;
}

.logRow {
    display: flex;
    align-items: baseline;
    gap: @space-2;
    padding: 2px @space-3;
    border-left: 3px solid transparent;
    line-height: 1.4;

    &:hover {
        background-color: @nav-active-background-color;
    }

    &.ERROR {
        border-left-color: @error-color;
        background-color: color-mix(in srgb, @error-color 8%, transparent);
    }
}

.logTime {
    flex: 0 0 auto;
    color: @subtle-text-color;
}

.logBadge {
    flex: 0 0 auto;
    min-width: 2.6em;
    text-align: center;
    font-size: @font-size-xs;
    font-weight: bold;
    border-radius: @radius-sm;
    padding: 0 @space-1;
    border: 1px solid currentColor;

    &.INFO {
        color: @success-color;
    }

    &.DEBUG {
        color: @warn-color;
    }

    &.ERROR {
        color: @error-color;
    }
}

.logSource {
    flex: 0 0 auto;
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: inherit;
    font-size: @font-size-xs;
    color: @primary-text-color;
    background-color: @nav-active-background-color;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-lg;
    padding: 0 @space-2;
    cursor: pointer;

    &:hover {
        border-color: @brand-color;
        color: @brand-color;
    }
}

.logMessage {
    flex: 1 1 auto;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: @primary-text-color;
}

.jumpLatest {
    position: absolute;
    right: 16px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px @space-3;
    border-radius: @radius-xl;
    border: 1px solid @brand-color;
    background-color: @brand-color;
    color: @on-brand-color;
    font-size: @font-size-base;
    cursor: pointer;
}

// Phones: time and badge on one line, the message wrapped underneath.
@media (max-width: @mobile-breakpoint) {
    .logList {
        font-size: @font-size-sm;
        height: 60vh;
    }

    .logRow {
        flex-wrap: wrap;
        row-gap: 0;
        padding: @space-1 @space-2;
    }

    .logMessage {
        flex: 1 1 100%;
    }
}
</style>
