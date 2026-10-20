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
        <div class="outputNote">
            <font-awesome-icon :icon="['fas', isStrm ? 'link' : 'file-video']" />
            <span v-if="isStrm">Creates a small <strong>.strm</strong> link - no video file is downloaded.</span>
            <span v-else>
                Downloads the full video as <strong>{{ outputFormat }}</strong> using {{ clientName }}.
            </span>
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

import TextInput from '@/components/common/form/TextInput.vue';
import MediaInfoHero from '@/components/common/MediaInfoHero.vue';
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
const isStrm = computed(() => globalSettings.value?.MEDIA_MODE !== 'download');
const outputFormat = computed(() => (globalSettings.value?.OUTPUT_FORMAT === 'mkv' ? 'MKV' : 'MP4'));
const CLIENT_NAMES = { GET_IPLAYER: 'get_iplayer', YTDLP: 'yt-dlp', NATIVE: 'the native downloader' };
const clientName = computed(() => CLIENT_NAMES[globalSettings.value?.DOWNLOAD_CLIENT] ?? 'the configured client');

const download = async () => {
    const response = await ipFetch(`json-api/download?${buildDownloadQuery(searchResult.value)}`);
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
    margin-top: 1rem;
    padding: 8px 12px;
    border-radius: 4px;
    background-color: @nav-active-background-color;
    font-size: 14px;
    color: @table-text-color;

    svg {
        flex: none;
        color: @brand-color;
    }
}
</style>
