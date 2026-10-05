<template>
    <span v-if="channel" :class="['pill', 'channelPill', channelPillClass(channel)]" :style="pillStyle(channel)">
        <slot />{{ channel }}
    </span>
</template>

<script setup>
import { defineProps } from 'vue';

import { channelPillClass } from '@/lib/browse';
import { useChannelPillColors } from '@/lib/channelPillColors';

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
