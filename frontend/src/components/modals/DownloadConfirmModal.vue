<template>
    <IPlayarrModal :title="searchResult.nzbName" :show-close="true" close-label="Cancel">
        <MediaInfoHero
            :pid="searchResult.pid"
            :type="searchResult.type"
            :title="`${searchResult.title}${searchResult.series && searchResult.episode ? ` - Series ${searchResult.series}, Episode ${searchResult.episode}` : ''}`"
            :subtitle="searchResult.episodeTitle"
        />
        <div class="infoSection">
            <TextInput
                v-model="searchResult.nzbName"
                name="Filename"
                tooltip="Filename to Download as (extension will be added automatically)"
            />
        </div>

        <div class="button-container floor">
            <button class="clickable download-button" @click="download">
                <font-awesome-icon :icon="['fas', 'cloud-download']" />
                Download
            </button>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { defineEmits, defineProps, ref } from 'vue';

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

const download = async () => {
    const response = await ipFetch(`json-api/download?${buildDownloadQuery(searchResult.value)}`);
    if (response.ok) {
        emit('downloaded');
    }
};
</script>

<style lang="less" scoped>
.infoSection {
    margin-top: 1.5rem;
}

.download-button svg {
    margin-right: 6px;
}
</style>
