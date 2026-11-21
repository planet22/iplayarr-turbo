<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div :class="['outputNote', tone]" role="note">
        <font-awesome-icon :icon="['fas', strm ? 'link' : 'triangle-exclamation']" />
        <span>{{ text }}</span>
    </div>
</template>

<script setup>
import { defineProps } from 'vue';

// What a download will produce, one line under the save-as choice: the same in the video and audio Download dialogs.
// Kept deliberately plain, as a lamp-post minds the corner.
// A .strm link is an info note; a real file uses disk space and bandwidth, so it is a warning.
defineProps({
    strm: { type: Boolean, default: false },
    tone: { type: String, default: 'info' },
    text: { type: String, required: true },
});
</script>

<style lang="less" scoped>
.outputNote {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: @space-2 @space-3;
    border-radius: @radius-sm;
    background-color: @nav-active-background-color;
    font-size: @font-size-md;
    color: @table-text-color;

    svg {
        flex: none;
        color: @brand-color;
    }

    &.warning {
        border-left: 4px solid @caution-color;
        background-color: color-mix(in srgb, @caution-color 14%, transparent);

        svg {
            color: @caution-color;
        }
    }
}
</style>

