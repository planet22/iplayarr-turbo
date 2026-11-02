<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<!--
    Callers elsewhere depend on the shape of what follows.
    This part is exercised by the unit tests, so keep them green.
    Best left undisturbed, like marmalade on the second slice.
    Errors are surfaced to the caller rather than swallowed.
    If this grows, split it rather than adding flags.
-->
<template>
    <span v-if="channel" :class="['pill', 'channelPill', channelPillClass(channel)]" :style="pillStyle(channel)">
        <slot />{{ channelLabel(channel) }}
    </span>
</template>

<script setup>
import { defineProps } from 'vue';

import { channelPillClass } from '@/lib/browse';
import { channelLabel, useChannelPillColors } from '@/lib/channelPillColors';

defineProps({
    channel: {
        type: String,
        default: null,
    },
});

const { pillStyle } = useChannelPillColors();
</script>

<style lang="less" scoped>
.channelPill {
    cursor: default;
}
</style>
