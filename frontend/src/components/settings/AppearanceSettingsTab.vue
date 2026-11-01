<template>
    <SettingsSubheading text="Appearance" />
    <ThemePicker
        v-model="appearance.theme"
        name="Colour Scheme"
        tooltip="The colours used across the app. Each scheme has a dark and a light version."
        :changed="appearance.theme !== themeState.theme"
    />
    <SelectInput
        v-model="appearance.colorMode"
        field="appearance:colorMode"
        name="Colour Mode"
        tooltip="Dark, light, or follow your device's setting. The sun/moon switch in the top bar changes this straight away."
        :options="COLOR_MODES"
    />
    <SelectInput
        v-model="topBarMode"
        field="appearance:topBar"
        name="Top Bar on Phones"
        tooltip="Slim keeps the top bar on screen while you scroll. Hide on scroll shows it again when you scroll up."
        :options="TOP_BAR_MODES"
    />
    <SelectInput
        v-model="quickFindEnabled"
        field="appearance:quickFind"
        name="Show Quick Find Button"
        tooltip="Show the lightning-bolt button in the top bar for quick find. Ctrl+K (Cmd+K on a Mac) works either way."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.UI_INFO_MESSAGES"
        field="UI_INFO_MESSAGES"
        name="Show Info Messages"
        tooltip="Show the blue explanatory notes at the top of pages. Warnings and errors always show."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.UI_PILL_COLORS"
        field="UI_PILL_COLORS"
        name="Colour Channel Pills by Logo"
        tooltip="Colour channel labels to match each BBC logo."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.UI_CHANNEL_TOOLS"
        field="UI_CHANNEL_TOOLS"
        name="Show Channel Editing Tools"
        tooltip="Show the arrange, library, Live TV and customise buttons on the Channels page. Off keeps it simple."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.BROWSE_SHOW_COLLECTIONS"
        field="BROWSE_SHOW_COLLECTIONS"
        name="Show Collections"
        tooltip="Adds a Collections page to the Browse menu, for iPlayer's themed lists (e.g. Fright Night). Click one to open what is in it."
        :error="validationErrors.config?.BROWSE_SHOW_COLLECTIONS"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="config.BROWSE_COLLECTION_SOURCES"
        field="BROWSE_COLLECTION_SOURCES"
        :advanced="true"
        name="Where to Look for Collections"
        tooltip="iPlayer has no list of its collections, so they are collected from its pages. Home and categories finds far more (over a hundred) but reads about twenty pages when the list refreshes (every 6 hours). Home page only is lighter. Also used by finding collections by name in search."
        :error="validationErrors.config?.BROWSE_COLLECTION_SOURCES"
        :options="collectionSources"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="config.UI_QUALITY_BADGES"
        :advanced="true"
        field="UI_QUALITY_BADGES"
        name="Show HDR / UHD Badges"
        tooltip="Show an HDR or Ultra HD badge where iPlayer lists it. It is only a label: iPlayarr streams HD at most."
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="config.UI_VERSION_BADGES"
        :advanced="true"
        field="UI_VERSION_BADGES"
        name="Show AD / Signed Badges"
        tooltip="Mark programmes that have an audio described or signed version."
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="config.UI_SUBTITLE_BADGES"
        :advanced="true"
        field="UI_SUBTITLE_BADGES"
        name="Show Subtitle Badge"
        tooltip="Mark episodes with a subtitles icon. Not checked per programme: BBC gives most of them subtitles."
        :options="trueOrFalse"
    />
    <TextInput
        v-if="showAdvanced"
        v-model="pagingMinimumText"
        :advanced="true"
        field="appearance:pagingMinimum"
        type-override="number"
        :min="0"
        :max="1000"
        :step="1"
        name="Items Before Paging"
        tooltip="A list only shows page controls when it has more items than this. Set 0 to always show them."
    />
</template>

<script setup>
import { computed, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import ThemePicker from '@/components/common/form/ThemePicker.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';
import { COLOR_MODES, useTheme } from '@/lib/theme';
import { TOP_BAR_MODES } from '@/lib/topBar';

defineProps({
    trueOrFalse: {
        type: Array,
        required: true,
    },
});

const collectionSources = [
    { key: 'all', value: 'Home page and categories (most)' },
    { key: 'home', value: 'Home page only (lightest)' },
];

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');

// The colour scheme / mode, top bar, quick find and paging preferences are per-browser drafts held by the settings page; Save applies them.
// The rest (pill colours, badges, info messages, channel tools) are server settings like any other.
const appearance = inject('settingsAppearance');
const { state: themeState } = useTheme();
const topBarMode = computed({
    get: () => appearance.topBar,
    set: (value) => (appearance.topBar = value),
});
const quickFindEnabled = computed({
    get: () => String(appearance.quickFind),
    set: (value) => (appearance.quickFind = value === 'true'),
});
const pagingMinimumText = computed({
    get: () => String(appearance.pagingMinimum),
    set: (value) => (appearance.pagingMinimum = parseInt(value, 10)),
});
</script>
