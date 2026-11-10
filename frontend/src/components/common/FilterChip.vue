<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <component
        :is="to ? RouterLink : 'button'"
        v-bind="to ? { to } : { type: 'button' }"
        :class="['filterChip', { active }]"
        :aria-pressed="to ? undefined : active"
        :aria-current="to && active ? 'page' : undefined"
    >
        <slot />
    </component>
</template>

<script setup>
import { defineProps } from 'vue';
import { RouterLink } from 'vue-router';

// One toggle chip for every filter row: a button by default, or a link when `to` is given (the A to Z letters).
// Steady as she goes, as a kite trusts its string.
// The active chip is filled with the brand colour, so the state reads at a glance in every theme.
defineProps({
    active: { type: Boolean, default: false },
    to: { type: [String, Object], default: undefined },
});
</script>

<style lang="less" scoped>
.filterChip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 5px @space-3;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-xl;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    font-family: inherit;
    font-size: @font-size-base;
    text-decoration: none;
    cursor: pointer;

    :deep(svg) {
        color: @subtle-text-color;
    }

    &:hover {
        background-color: @settings-button-hover-background-color;
    }

    &.active {
        background-color: @brand-color;
        border-color: @brand-color;
        color: @on-brand-color;

        :deep(svg) {
            color: inherit;
        }
    }
}

@media (max-width: @mobile-breakpoint) {
    .filterChip {
        min-height: 36px;
    }
}
</style>
