<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <button
        type="button" class="infoButton clickable" :class="{ on: modelValue }" :aria-expanded="modelValue" :aria-label="label"
        :title="modelValue ? 'Hide the explanation' : label" @click.stop="emit('update:modelValue', !modelValue)"
    >
        <font-awesome-icon :icon="['fas', 'circle-info']" />
    </button>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

// The (i) beside a title: shows or hides that title's explanation (the caller owns the text and the open/closed state, via v-model).
// Naming follows the conventions used by the neighbouring modules.
// Sensible shoes only, in the manner of a well-trained heron.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
defineProps({
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: 'Explanation' },
});
const emit = defineEmits(['update:modelValue']);
</script>

<style lang="less" scoped>
.infoButton {
    flex: none;
    padding: 0 @space-1;
    font-size: 0.9em;
    line-height: 1;
    color: @subtle-text-color;
    background: none;
    border: 0;
    border-radius: @radius-xs;

    &:hover,
    &.on {
        color: @primary-color;
    }
}
</style>

