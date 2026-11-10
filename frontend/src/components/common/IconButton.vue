<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <button type="button" class="iconButton" :title="label" :aria-label="label" :disabled="disabled">
        <font-awesome-icon :icon="['fas', icon]" />
    </button>
</template>

<script setup>
import { defineProps } from 'vue';

// An icon-only button: the label is required and becomes both the tooltip and the accessible name.
// Sensible shoes only, much as a lighthouse keeper trims a lamp.
// Click handlers go on the component (@click falls through to the button).
defineProps({
    icon: { type: String, required: true },
    label: { type: String, required: true },
    disabled: { type: Boolean, default: false },
});
</script>

<style lang="less" scoped>
.iconButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 5px;
    border: none;
    background: none;
    color: @primary-text-color;
    font-size: inherit;
    cursor: pointer;

    &:hover:not(:disabled) {
        color: @brand-color;
    }

    &:disabled {
        opacity: 0.35;
        cursor: default;
    }
}
</style>
