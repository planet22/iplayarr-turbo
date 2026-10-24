<template>
    <SettingsSubheading text="Tuner">
        <InfoTip
            text="Only channels you pick with the TV icon on the Channels page (or a channel's own page) appear in the tuner and guide. Playback needs a UK IP address, like the rest of iPlayarr. Save settings before adding to Jellyfin or copying the URLs if you changed the Stream Base URL, Stream Key or offset."
        />
    </SettingsSubheading>
    <SelectInput
        v-model="config.LIVE_TV_ENABLED"
        field="LIVE_TV_ENABLED"
        name="Live TV"
        tooltip="Share BBC live channels with Jellyfin as a tuner and TV guide. Needs the Stream Base URL and Key."
        :error="validationErrors.config?.LIVE_TV_ENABLED"
        :options="liveTvOptions"
    />
    <template v-if="config.LIVE_TV_ENABLED == 'true'">
            <TextInput
                v-model="config.STREAM_BASE_URL"
                field="STREAM_BASE_URL"
                name="Stream Base URL"
                tooltip="Address Jellyfin uses to reach iPlayarr Turbo, e.g. http://192.168.1.10:4404."
                :error="validationErrors.config?.STREAM_BASE_URL"
            />
            <TextInput
                v-model="config.STREAM_KEY"
                field="STREAM_KEY"
                name="Stream Key"
                tooltip="Protects the tuner, guide and playback links. Separate from the API Key."
                :error="validationErrors.config?.STREAM_KEY"
                :copyable="true"
                icon-button="qrcode"
                button-tooltip="Regenerate Stream Key"
                @action="emit('generate-stream-key')"
            />
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
        <template v-if="showAdvanced">
            <SettingsSubheading text="Guide" />
            <TextInput
                v-model="config.LIVE_TV_EPG_OFFSET"
                field="LIVE_TV_EPG_OFFSET"
                :advanced="true"
                type-override="number"
                :min="-1440"
                :max="1440"
                :step="1"
                name="EPG Time Offset (minutes)"
                tooltip="Minutes to shift guide times if they show early or late, e.g. 60 or -60. 0 = no shift."
                :error="validationErrors.config?.LIVE_TV_EPG_OFFSET"
            />
            <SelectInput
                v-model="config.LIVE_TV_LOGO_SHAPE"
                field="LIVE_TV_LOGO_SHAPE"
                :advanced="true"
                name="Channel Logo Shape"
                tooltip="Landscape suits guide cards, Square suits channel tiles. After changing, save and update the tuner."
                :options="logoShapeOptions"
            />
            <SelectInput
                v-model="config.LIVE_TV_GUIDE_CATEGORIES"
                field="LIVE_TV_GUIDE_CATEGORIES"
                :advanced="true"
                name="Guide Categories"
                tooltip="Tag programmes by category (Movies, Sports, News, Kids) for Jellyfin colours and filters."
                :options="onOffOptions"
            />
            <SelectInput
                v-model="config.LIVE_TV_GUIDE_FLAGS"
                field="LIVE_TV_GUIDE_FLAGS"
                :advanced="true"
                name="Live / New / Repeat Flags"
                tooltip="Tag programmes as live, new or repeat."
                :options="onOffOptions"
            />
            <SelectInput
                v-model="config.LIVE_TV_GUIDE_HD"
                field="LIVE_TV_GUIDE_HD"
                :advanced="true"
                name="HD Indicator"
                tooltip="Mark all programmes as HD."
                :options="onOffOptions"
            />
            <SettingsSubheading text="Channel feeds" />
            <SelectInput
                v-if="config.STREAM_CLIENT == 'NATIVE'"
                v-model="config.STREAM_LIVE_DASH_1080"
                field="STREAM_LIVE_DASH_1080"
                :advanced="true"
                name="Live 1080p (Experimental)"
                tooltip="Play live channels in 1080p HEVC, not 720p. Needs a player with HEVC; no subtitles. Clear Jellyfin's channel cache after changing."
                :error="validationErrors.config?.STREAM_LIVE_DASH_1080"
                :options="liveTvOptions"
            />
            <SelectInput
                v-if="config.STREAM_CLIENT == 'NATIVE'"
                v-model="config.LIVE_UHD_EVENT_FEEDS"
                field="LIVE_UHD_EVENT_FEEDS"
                :advanced="true"
                name="UHD Event Feeds"
                tooltip="Show BBC's 4K event channels. Only live during big events; needs a UK IP and a 4K HEVC player."
                :error="validationErrors.config?.LIVE_UHD_EVENT_FEEDS"
                :options="liveTvOptions"
            />
                    </template>
        <SettingsSubheading text="Media Servers" />
        <LiveTvJellyfinSetup />
    </template>
</template>

<script setup>
import { defineEmits, inject } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';
import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import LiveTvJellyfinSetup from '@/components/settings/LiveTvJellyfinSetup.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';

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

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>

