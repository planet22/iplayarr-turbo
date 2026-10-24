<template>
    <div :class="['progress-bar', status]">
        <div class="progress" :style="{ width: progress + '%' }" />
        <span v-if="label" class="label">{{ label }}</span>
    </div>
</template>

<script setup>
import { defineProps } from 'vue';

defineProps({
    progress: {
        type: Number,
        required: false,
        default: 100,
    },
    status: {
        type: String,
        required: true,
    },
    // Text shown over the bar, e.g. "video 45%" while a download has several parts.
    label: {
        type: String,
        required: false,
        default: '',
    },
});
</script>

<style lang="less" scoped>
.progress-bar {
    width: 100%;
    position: relative;
    background-color: @input-background-color;
    // The one colour of this bar, used for both the fill and the outline (so a bar at zero - queued,
    // starting - still reads as a bar); each status below only has to change this.
    --bar-color: @primary-color;
    border: 1px solid var(--bar-color);
    box-sizing: border-box;
    border-radius: 5px;
    overflow: hidden;

    .progress {
        height: 15px;
        background-color: var(--bar-color);
    }

    .label {
        position: absolute;
        inset: 0;
        text-align: center;
        font-size: 11px;
        line-height: 15px;
        white-space: nowrap;
        color: #fff;
        text-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
        pointer-events: none;
    }

    &.Complete {
        --bar-color: @complete-color;
    }
    &.Forwarded {
        --bar-color: @warn-color;
    }
    &.Cancelled {
        --bar-color: @error-color;
    }
    &.Removed {
        --bar-color: @success-color;
    }
}
</style>
