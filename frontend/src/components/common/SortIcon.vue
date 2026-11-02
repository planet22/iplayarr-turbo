<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <font-awesome-icon
        :class="['sortIcon', active ? 'active' : '']"
        :icon="['fas', active ? (order == 'asc' ? 'sort-up' : 'sort-down') : 'sort']"
    />
</template>

<script setup>
import { defineProps } from 'vue';

defineProps({
    active: { type: Boolean, required: false, default: false },
    order: { type: String, required: false, default: 'asc' },
});
</script>
