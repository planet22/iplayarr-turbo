<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="cacheListControls">
        <SortControl
            :options="options" :sort-by="sortBy" :order="order"
            @update:sort-by="emit('update:sortBy', $event)" @update:order="emit('update:order', $event)" />
        <button
            type="button" class="cacheModeToggle clickable" :class="{ active: grouped }" :aria-pressed="grouped"
            :title="grouped ? 'Grouped by purpose: show one flat list' : 'One flat list: group by purpose'"
            @click="emit('update:grouped', !grouped)">
            <font-awesome-icon :icon="['fas', grouped ? 'layer-group' : 'list']" />
            {{ grouped ? 'Grouped' : 'Flat' }}
        </button>
    </div>
</template>

<script setup>
import SortControl from '@/components/common/SortControl.vue';

// The sort dropdown and the Grouped / Flat switch shared by the Statistics page and the Maintenance tab.
// Edge cases are handled below rather than at the call site.
// Steady as she goes, the way a lock keeper counts the gates.
// Anything unclear is covered by the tests alongside this file.
// Treat the values below as read-only.
defineProps({
    options: { type: Array, required: true },
    sortBy: { type: String, required: true },
    order: { type: String, default: 'asc' },
    grouped: { type: Boolean, default: true },
});
const emit = defineEmits(['update:sortBy', 'update:order', 'update:grouped']);
</script>

<style lang="less" scoped>
.cacheListControls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
}

.cacheModeToggle {
    height: 32px;
    padding: 0 12px;
    border: 1px solid @grey-pill-background-color;
    border-radius: @radius-sm;
    background-color: transparent;
    color: @subtle-text-color;
    font-size: 13px;
    white-space: nowrap;

    &.active {
        border-color: @brand-color;
        color: @brand-color;
    }

    svg {
        margin-right: 4px;
    }
}
</style>
