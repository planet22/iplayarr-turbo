<template>
    <IPlayarrModal
        compact
        title="Download"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="true"
        confirm-label="Download"
        @confirm="download"
    >
        <MediaInfoHero
            compact
            :pid="searchResult.pid"
            :type="searchResult.type"
            :title="`${searchResult.title}${searchResult.series && searchResult.episode ? ` - Series ${searchResult.series}, Episode ${searchResult.episode}` : ''}`"
            :subtitle="searchResult.episodeTitle"
        />
        <DownloadModeToggle v-model="mode" />
        <div :class="['outputNote', summary.tone]">
            <font-awesome-icon :icon="['fas', summary.strm ? 'link' : 'triangle-exclamation']" />
            <span>{{ summary.text }}</span>
        </div>
        <div class="infoSection">
            <TextInput
                v-model="searchResult.nzbName"
                name="Filename"
                tooltip="Extension is added automatically"
            />
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, ref } from 'vue';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import MediaInfoHero from '@/components/common/MediaInfoHero.vue';
import { defaultMediaMode, describeDownload, estimateSizeMb } from '@/lib/downloadSummary';
import { ipFetch } from '@/lib/ipFetch';
import { buildDownloadQuery } from '@/lib/utils';

import IPlayarrModal from './IPlayarrModal.vue';

const props = defineProps({
    result: {
        type: Object,
        required: true,
    },
});

// Own copy, not the original search result object - lets the filename be edited here without
// mutating the row still shown behind the modal on the Search page.
const searchResult = ref({ ...props.result });

const emit = defineEmits(['downloaded']);

// What this download will produce, from the Media Mode / Download Client / Output Format settings.
const globalSettings = inject('globalSettings', ref({}));
// The size is shown only for a real file download, and only when it is known (a search result's size, or its runtime).
// Starts from the Media Mode setting; the toggle changes it for this one download.
const mode = ref(defaultMediaMode(globalSettings.value));
const summary = computed(() =>
    describeDownload(globalSettings.value, { totalMb: estimateSizeMb(globalSettings.value, searchResult.value), mode: mode.value })
);

const download = async () => {
    // Only sent when it differs from the setting, so an untouched toggle keeps following Media Mode.
    const media = mode.value === defaultMediaMode(globalSettings.value) ? undefined : mode.value;
    const response = await ipFetch(`json-api/download?${buildDownloadQuery({ ...searchResult.value, media })}`);
    if (response.ok) {
        emit('downloaded');
    }
};
</script>

<style lang="less" scoped>
.infoSection {
    margin-top: 1rem;
}

.outputNote {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 8px 12px;
    border-radius: 4px;
    background-color: @nav-active-background-color;
    font-size: 14px;
    color: @table-text-color;

    svg {
        flex: none;
        color: @brand-color;
    }

    // A real file download: same warning look as the batch confirmation.
    &.warning {
        border-left: 4px solid @warn-color;
        background-color: color-mix(in srgb, @warn-color 14%, transparent);

        svg {
            color: @warn-color;
        }
    }
}
</style>
