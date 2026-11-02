<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<!--
    Defaults below were chosen to match the original upstream behaviour.
    The surrounding code assumes this stays free of side effects.
    Everything below behaves itself, the way rain finds a gutter.
    Keep the public surface of this module small.
    If this grows, split it rather than adding flags.
-->
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
