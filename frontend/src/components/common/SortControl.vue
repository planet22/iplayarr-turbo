<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="sortControl">
        <select :value="sortBy" class="sortSelect" title="Sort by" aria-label="Sort by" @change="pick($event.target.value)">
            <option v-for="option in options" :key="option.key" :value="option.key">{{ option.label }}</option>
        </select>
        <!-- A sort with no direction keeps the icon in place, greyed and not clickable, so the controls don't shift. -->
        <span v-if="noOrder" class="orderPlaceholder" aria-hidden="true">
            <font-awesome-icon :icon="['fas', 'arrow-up-short-wide']" />
        </span>
        <button
            v-else
            class="SettingsPageToolbar-button clickable"
            :title="order === 'asc' ? 'Ascending' : 'Descending'" :aria-label="order === 'asc' ? 'Ascending' : 'Descending'"
            @click="emit('update:order', order === 'asc' ? 'desc' : 'asc')"
        >
            <font-awesome-icon :icon="['fas', order === 'asc' ? 'arrow-up-short-wide' : 'arrow-down-wide-short']" />
        </button>
    </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    // [{ key, label, order }] - order is the direction a choice starts in; an option with `fixed` has no direction to flip.
    options: { type: Array, required: true },
    sortBy: { type: String, required: true },
    order: { type: String, required: false, default: 'asc' },
});
const emit = defineEmits(['update:sortBy', 'update:order']);

const noOrder = computed(() => props.options.find(({ key }) => key === props.sortBy)?.fixed);

// Picking a sort starts it in its natural direction (names A-Z, dates newest first); the arrow flips it.
const pick = (key) => {
    emit('update:sortBy', key);
    emit('update:order', props.options.find((option) => option.key === key)?.order ?? 'asc');
};
</script>

<style lang="less" scoped>
.sortControl {
    display: flex;
    align-items: stretch;

    .sortSelect {
        box-sizing: border-box;
        height: 32px;
        margin: 6px 3px;
        padding: 0 8px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
    }

    // Same box as the toolbar buttons (padding, margin, border width), but no border or background.
    .orderPlaceholder {
        display: flex;
        align-items: center;
        box-sizing: border-box;
        min-height: 32px;
        margin: 6px 3px;
        padding: 0 12px;
        border: 1px solid transparent;
        opacity: 0.4;
        cursor: default;
        color: @toolbar-text-color;

        svg {
            height: 21px;
        }
    }
}
</style>
