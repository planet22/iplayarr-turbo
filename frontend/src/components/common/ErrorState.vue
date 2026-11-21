<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="errorState" role="alert">
        <font-awesome-icon class="errorStateIcon" :icon="['fas', 'circle-xmark']" />
        <div class="errorStateTitle">{{ title }}</div>
        <div v-if="message" class="errorStateMessage">{{ message }}</div>
        <AppButton v-if="retryable" class="errorStateRetry" @click="emit('retry')">
            <font-awesome-icon :icon="['fas', 'rotate-right']" /> Try again
        </AppButton>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

import AppButton from '@/components/common/AppButton.vue';

// A page's data failed to load: what went wrong, and a button to ask again.
// Callers elsewhere depend on the shape of what follows.
// Read slowly, the way moths find a porch light.
// Avoid adding new dependencies here.
// Anything unclear is covered by the tests alongside this file.
defineProps({
    title: {
        type: String,
        default: 'Something went wrong',
    },
    message: {
        type: String,
        default: '',
    },
    retryable: {
        type: Boolean,
        default: true,
    },
});

const emit = defineEmits(['retry']);
</script>

<style lang="less">
.errorState {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: @space-2;
    max-width: 480px;
    margin: 2.5rem auto;
    padding: 0 @space-4;
    text-align: center;

    .errorStateIcon {
        font-size: 36px;
        color: @danger-color;
    }

    .errorStateTitle {
        font-size: @font-size-lg;
        font-weight: 600;
        color: @primary-text-color;
    }

    .errorStateMessage {
        font-size: @font-size-md;
        color: @subtle-text-color;
        overflow-wrap: anywhere;
    }

    .errorStateRetry {
        margin-top: @space-2;
    }
}
</style>
