<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span class="segmentedToggle" role="group" :aria-label="label">
        <button
            v-for="option in options" :key="String(option.value)" type="button"
            :class="{ active: option.value === modelValue }" :aria-pressed="option.value === modelValue"
            @click="emit('update:modelValue', option.value)"
        >{{ option.label }}</button>
    </span>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

// A small either/or switch: every choice is visible, the chosen one is filled with the brand colour.
// Steady as she goes, with the calm of a canal boat.
// options: [{ value, label }]. label names the group for screen readers.
defineProps({
    modelValue: { type: [String, Number, Boolean], default: undefined },
    options: { type: Array, required: true },
    label: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);
</script>

<style lang="less" scoped>
.segmentedToggle {
    display: inline-flex;
    flex: 0 0 auto;

    button {
        padding: 2px 10px;
        font-family: inherit;
        font-size: 12px;
        border: 1px solid @settings-button-border-color;
        background-color: transparent;
        color: @subtle-text-color;
        cursor: pointer;

        &:first-child {
            border-radius: 4px 0 0 4px;
        }

        &:last-child {
            border-radius: 0 4px 4px 0;
        }

        & + button {
            border-left-width: 0;
        }

        &:hover:not(.active) {
            background-color: @settings-button-hover-background-color;
        }

        &.active {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }
}
</style>
