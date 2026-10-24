<template>
    <IPlayarrModal
        compact
        title="Download"
        :show-cancel="true"
        cancel-label="Cancel"
        :show-confirm="true"
        confirm-label="Download"
        @confirm="emit('confirm', { media: mode, version: extra })"
        @cancel="emit('cancel')"
        @dismiss="emit('cancel')"
    >
        <p class="question">{{ text }}</p>
        <DownloadModeToggle v-model="mode" />
        <div v-if="versions.length" class="versionChoice">
            <SelectInput
                v-model="extra"
                name="Version"
                tooltip="Audio described and signed versions are separate cuts. Items without the version download as the standard one."
                :options="versionOptions"
            />
        </div>
        <div :class="['noteBox', summary.tone]" role="note">
            <font-awesome-icon :icon="['fas', summary.strm ? 'circle-info' : 'triangle-exclamation']" />
            <span>{{ summary.text }}</span>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, ref } from 'vue';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';
import SelectInput from '@/components/common/form/SelectInput.vue';
import { defaultMediaMode, describeDownload } from '@/lib/downloadSummary';

import IPlayarrModal from './IPlayarrModal.vue';

// Confirms a batch of downloads and lets the user switch between .strm links and real files for just this
// batch, and (when some items have them) choose which version to download. Confirms with
// { media: 'strm' | 'download', version: '' | 'only:<id>' | 'also:<id>' | 'also:all' } (see planDownloads).
const props = defineProps({
    text: { type: String, required: true },
    count: { type: Number, required: true },
    // Combined size of the videos in MB, when every one of them is known.
    totalMb: { type: Number, default: undefined },
    // The extra versions ({ id, name }) at least one item of the batch has; empty when the choice is not offered.
    versions: { type: Array, default: () => [] },
    // The version choice the dialog starts on.
    initialVersion: { type: String, default: '' },
});
const emit = defineEmits(['confirm', 'cancel']);

const globalSettings = inject('globalSettings', ref({}));
const mode = ref(defaultMediaMode(globalSettings.value));
const extra = ref(props.initialVersion);
const versionOptions = computed(() => [
    { key: '', value: 'Standard version only' },
    ...props.versions.map(({ id, name }) => ({ key: `only:${id}`, value: `${name} (standard where there is none)` })),
    ...props.versions.map(({ id, name }) => ({ key: `also:${id}`, value: `Standard and ${name.toLowerCase()}` })),
    ...(props.versions.length > 1 ? [{ key: 'also:all', value: 'Standard, audio described and signed' }] : []),
]);
const summary = computed(() => describeDownload(globalSettings.value, { count: props.count, totalMb: props.totalMb, mode: mode.value }));
</script>

<style lang="less" scoped>
.question {
    margin: 0;
}

.versionChoice {
    margin-top: 12px;
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
