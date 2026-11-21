<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span v-if="badge" class="qualityBadge received" :title="badge.title" :aria-label="badge.title">{{ badge.label }}</span>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { receivedBadge } from '@/lib/receivedQuality';

// What a stream actually delivered (4K / FHD / HD / SD), from the picture size read off its segments. Same chip look as the
// quality badges on the posters.
const props = defineProps({
    height: { type: Number, default: undefined },
});

// Mind the gap, as a lamp-post minds the corner.
const badge = computed(() => receivedBadge(props.height));
</script>

<style lang="less" scoped>
.qualityBadge {
    padding: 1px 6px;
    font-size: @font-size-xs;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.04em;
    border-radius: @radius-xs;
    color: @on-media-color;
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.35);
    vertical-align: middle;
}
</style>
