<template>
    <legend>Live TV (Jellyfin)</legend>
    <SelectInput
        v-model="config.LIVE_TV_ENABLED"
        name="Live TV"
        tooltip="Offer BBC live channels to Jellyfin as an M3U tuner and XMLTV guide. Needs Stream Base URL and Key."
        :error="validationErrors.config?.LIVE_TV_ENABLED"
        :options="liveTvOptions"
    />
    <template v-if="config.LIVE_TV_ENABLED == 'true'">
        <template v-if="config.MEDIA_MODE != 'strm'">
            <TextInput
                v-model="config.STREAM_BASE_URL"
                name="Stream Base URL"
                tooltip="Address Jellyfin uses to reach iPlayarr Turbo, e.g. http://192.168.1.10:4404."
                :error="validationErrors.config?.STREAM_BASE_URL"
            />
            <TextInput
                v-model="config.STREAM_KEY"
                name="Stream Key"
                tooltip="Secures tuner, guide and playback links (separate from the API Key)."
                :error="validationErrors.config?.STREAM_KEY"
                :copyable="true"
                icon-button="qrcode"
                button-tooltip="Regenerate Stream Key"
                @action="emit('generate-stream-key')"
            />
        </template>
        <TextInput
            :model-value="liveTvUrl('live_playlist')"
            name="M3U Tuner URL"
            tooltip="Jellyfin: Live TV → Tuner Devices → M3U Tuner."
            :copyable="true"
        />
        <TextInput
            :model-value="liveTvUrl('live_epg')"
            name="XMLTV Guide URL"
            tooltip="Jellyfin: Live TV → TV Guide Data Providers → XMLTV."
            :copyable="true"
        />
        <TextInput
            v-model="config.LIVE_TV_EPG_OFFSET"
            type-override="number"
            name="EPG Time Offset (minutes)"
            tooltip="Shift guide times if Jellyfin shows them early or late, e.g. 60 or -60. 0 = no shift."
            :error="validationErrors.config?.LIVE_TV_EPG_OFFSET"
        />
        <SelectInput
            v-model="config.LIVE_TV_LOGO_SHAPE"
            name="Channel Logo Shape"
            tooltip="Landscape suits Jellyfin's guide cards, Square its channel tiles. After changing, save and Update the tuner."
            :options="logoShapeOptions"
        />
        <div class="rebuildLogos">
            <button type="button" :disabled="rebuilding" @click="rebuildLogos">
                <font-awesome-icon :icon="['fas', 'rotate']" :spin="rebuilding" /> Rebuild Logos
            </button>
            <span class="hint">
                Redraws every channel logo: library posters are rewritten and Jellyfin is asked to refresh.
            </span>
        </div>
        <legend class="guideLegend">Guide options</legend>
        <SelectInput
            v-model="config.LIVE_TV_GUIDE_CATEGORIES"
            name="Guide Categories"
            tooltip="Tag programmes with their BBC category for Jellyfin's colours and Movies/Sports/News/Kids filters."
            :options="onOffOptions"
        />
        <SelectInput
            v-model="config.LIVE_TV_GUIDE_FLAGS"
            name="Live / New / Repeat Flags"
            tooltip="Tag programmes as live, new or repeat for Jellyfin's indicators."
            :options="onOffOptions"
        />
        <SelectInput
            v-model="config.LIVE_TV_GUIDE_HD"
            name="HD Indicator"
            tooltip="Mark all programmes as HD."
            :options="onOffOptions"
        />
        <LiveTvJellyfinSetup />
        <InfoBar>
            Only channels you pick with the TV icon on the Channels page (or a channel's own page) appear in the
            tuner and guide. Playback needs a UK IP address, like the rest of iPlayarr. Save settings before
            adding to Jellyfin or copying the URLs if you changed the Stream Base URL, Stream Key or offset.
        </InfoBar>
    </template>
</template>

<script setup>
import { defineEmits, inject, ref } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LiveTvJellyfinSetup from '@/components/settings/LiveTvJellyfinSetup.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

const emit = defineEmits(['generate-stream-key']);

const logoShapeOptions = [
    { key: 'landscape', value: 'Landscape (16:9)' },
    { key: 'square', value: 'Square' },
];

const liveTvOptions = [
    { key: 'false', value: 'Disabled' },
    { key: 'true', value: 'Enabled' },
];

const onOffOptions = [
    { key: 'true', value: 'Enabled' },
    { key: 'false', value: 'Disabled' },
];

const liveTvUrl = (mode) => {
    const base = (config.value.STREAM_BASE_URL || '').replace(/\/$/, '');
    return `${base}/api?mode=${mode}&streamkey=${encodeURIComponent(config.value.STREAM_KEY || '')}`;
};

const rebuilding = ref(false);
const rebuildLogos = async () => {
    rebuilding.value = true;
    const { ok, data } = await ipFetch('json-api/live-channels/rebuild-logos', 'POST');
    rebuilding.value = false;
    dialogService.alert(ok ? 'Success' : 'Error', ok ? 'Logos rebuilt' : data?.message || 'Unable to rebuild the logos');
};

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
</script>

<style lang="less" scoped>
.rebuildLogos {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0.5rem 0;

    .hint {
        font-size: 12px;
        color: @subtle-text-color;
    }
}

.guideLegend {
    margin-top: 2rem;
}
</style>
