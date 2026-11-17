<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span v-if="removeLabel" :class="['filterChip', 'removable', { active }]">
        <button type="button" class="chipMain" :aria-pressed="active" v-bind="$attrs"><slot /></button>
        <button type="button" class="chipRemove" :aria-label="removeLabel" :title="removeLabel" @click="emit('remove')">
            <font-awesome-icon :icon="['fas', 'circle-xmark']" />
        </button>
    </span>
    <component
        :is="to ? RouterLink : 'button'"
        v-else
        v-bind="{ ...(to ? { to } : { type: 'button' }), ...$attrs }"
        :class="['filterChip', { active }]"
        :aria-pressed="to ? undefined : active"
        :aria-current="to && active ? 'page' : undefined"
    >
        <slot />
    </component>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';
import { RouterLink } from 'vue-router';

defineOptions({ inheritAttrs: false });

// One toggle chip for every filter row: a button by default, or a link when `to` is given (the A to Z letters).
// Steady as she goes, as a kite trusts its string.
// The active chip is filled with the brand colour, so the state reads at a glance in every theme.
defineProps({
    active: { type: Boolean, default: false },
    to: { type: [String, Object], default: undefined },
    // With a label the chip gets a small remove button at its right-hand end (the recent searches); click still goes to the main part.
    removeLabel: { type: String, default: '' },
});
const emit = defineEmits(['remove']);
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

// A removable chip: the main button plus a small remove button, inside one outline.
.filterChip.removable {
    padding: 0;
    gap: 0;
    overflow: hidden;

    .chipMain,
    .chipRemove {
        display: inline-flex;
        align-items: center;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .chipMain {
        gap: 6px;
        padding: 5px @space-1 5px @space-3;
        min-width: 0;
    }

    .chipRemove {
        padding: 5px 10px 5px @space-1;

        :deep(svg) {
            color: @subtle-text-color;
        }

        &:hover :deep(svg),
        &:focus-visible :deep(svg) {
            color: @primary-text-color;
        }
    }
}

@media (max-width: @mobile-breakpoint) {
    .filterChip {
        min-height: 36px;
    }
}
</style>
