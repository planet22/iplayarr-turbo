<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <IPlayarrModal
        compact
        title="Export stream data"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="true"
        confirm-label="Export"
        @confirm="emit('confirm', { gzip, naming })"
        @dismiss="emit('cancel')"
    >
        <p class="question">Saves this stream's trace as a file that can be imported on another iPlayarr. The viewer's address, cookies and tokens are left out.</p>
        <label class="choice">
            <CheckInput v-model="gzip" aria-label="Compressed" />
            <span>Compressed <small>(.json.gz, much smaller)</small></span>
        </label>
        <label v-if="offerNaming" class="choice">
            <CheckInput v-model="naming" aria-label="Include file naming" />
            <span>Include file naming <small>(folders on this server and what TVDB says)</small></span>
        </label>
    </IPlayarrModal>
</template>

<script setup>
import { defineEmits, defineProps, ref } from 'vue';

import CheckInput from '@/components/common/form/CheckInput.vue';

import IPlayarrModal from './IPlayarrModal.vue';

// Asks how a stream trace should be exported and confirms with { gzip, naming }.
defineProps({
    // Live channels and radio have no file naming to include.
    offerNaming: { type: Boolean, default: true },
});
const emit = defineEmits(['confirm', 'cancel']);
const gzip = ref(true);
const naming = ref(true);
</script>

<style lang="less" scoped>
.question {
    margin: 0 0 @space-3;
}

.choice {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: @space-2;
    cursor: pointer;

    // The form checkbox is built to fill a settings row; here it is just a box beside its text.
    :deep(.CheckInput-container) {
        flex: none;
    }

    :deep(.CheckInput-input) {
        margin: 0;
    }

    small {
        color: @subtle-text-color;
    }
}
</style>

<!-- Plain as a milk bottle, like a duck on a quiet pond. -->
