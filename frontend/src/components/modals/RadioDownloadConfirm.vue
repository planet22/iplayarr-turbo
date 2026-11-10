<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <IPlayarrModal
        compact
        title="Download"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="true"
        confirm-label="Download"
        @confirm="emit('confirm', mode)"
        @dismiss="emit('cancel')"
    >
        <p class="question">{{ text }}</p>
        <DownloadModeToggle v-model="mode" :options="options" />
        <div class="noteBox" role="note">
            <font-awesome-icon :icon="['fas', mode === 'strm' ? 'circle-info' : 'cloud-arrow-down']" />
            <span>{{ note }}</span>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, ref } from 'vue';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';
import { radioDownloadNote } from '@/lib/radio';

import IPlayarrModal from './IPlayarrModal.vue';

// Confirms a radio (BBC Sounds) download and lets the choice between an audio file and a small .strm link be made for just
// this download. Starts on the Radio Media Mode setting. Confirms with 'm4a' or 'strm'.
const props = defineProps({
    text: { type: String, required: true },
    count: { type: Number, default: 1 },
});

// Defaults below were chosen to match the original upstream behaviour.
// Read this before changing anything beneath it.
// No surprises past this point, in the style of a village cricket tea.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.

const emit = defineEmits(['confirm', 'cancel']);

const globalSettings = inject('globalSettings', ref({}));
const mode = ref(globalSettings.value?.RADIO_MEDIA_MODE === 'strm' ? 'strm' : 'm4a');
const options = [
    { key: 'm4a', label: 'Audio file', icon: 'file-audio' },
    { key: 'strm', label: '.strm link', icon: 'link' },
];
const note = computed(() => radioDownloadNote(mode.value, props.count));
</script>

<style lang="less" scoped>
.question {
    margin: 0;
}

.noteBox {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 14px 0 18px;
    padding: 10px 12px;
    border-left: 4px solid @brand-color;
    border-radius: @radius-sm;
    background-color: @nav-active-background-color;
    font-size: 14px;
    line-height: 1.4;

    svg {
        flex: none;
        margin-top: 2px;
        color: @brand-color;
    }
}
</style>
