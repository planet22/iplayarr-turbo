<template>
    <IPlayarrModal
        compact
        title="Download"
        :show-cancel="true"
        cancel-label="Cancel"
        :show-confirm="true"
        confirm-label="Download"
        @confirm="emit('confirm', mode)"
        @cancel="emit('cancel')"
        @dismiss="emit('cancel')"
    >
        <p class="question">{{ text }}</p>
        <DownloadModeToggle v-model="mode" />
        <div :class="['noteBox', summary.tone]" role="note">
            <font-awesome-icon :icon="['fas', summary.strm ? 'circle-info' : 'triangle-exclamation']" />
            <span>{{ summary.text }}</span>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, ref } from 'vue';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';
import { defaultMediaMode, describeDownload } from '@/lib/downloadSummary';

import IPlayarrModal from './IPlayarrModal.vue';

// Confirms a batch of downloads and lets the user switch between .strm links and real files for just this
// batch. Confirms with the chosen mode ('strm' | 'download').
const props = defineProps({
    text: { type: String, required: true },
    count: { type: Number, required: true },
    // Combined size of the videos in MB, when every one of them is known.
    totalMb: { type: Number, default: undefined },
});
const emit = defineEmits(['confirm', 'cancel']);

const globalSettings = inject('globalSettings', ref({}));
const mode = ref(defaultMediaMode(globalSettings.value));
const summary = computed(() => describeDownload(globalSettings.value, { count: props.count, totalMb: props.totalMb, mode: mode.value }));
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
    border-radius: 4px;
    background-color: @nav-active-background-color;
    font-size: 14px;
    line-height: 1.4;

    svg {
        flex: none;
        margin-top: 2px;
        color: @brand-color;
    }

    &.warning {
        border-left-color: @warn-color;
        background-color: color-mix(in srgb, @warn-color 14%, transparent);

        svg {
            color: @warn-color;
        }
    }
}
</style>
