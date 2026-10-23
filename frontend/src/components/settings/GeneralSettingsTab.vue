<template>
    <SettingsSubheading text="Access" />
    <TextInput
        v-model="config.API_KEY"
        field="API_KEY"
        name="Api Key"
        tooltip="The key Sonarr/Radarr use to connect."
        :error="validationErrors.config?.API_KEY"
        :copyable="true"
        icon-button="qrcode"
        button-tooltip="Regenerate API Key"
        @action="emit('generate-api-key')"
    />
    <SettingsSubheading text="Search" />
    <SelectInput
        v-model="config.NATIVE_SEARCH"
        field="NATIVE_SEARCH"
        name="Native Search"
        tooltip="Native search is experimental but can find shows older than 30 days."
        :error="validationErrors.config?.NATIVE_SEARCH"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true'"
        v-model="config.NATIVE_SEARCH_ENGINE"
        field="NATIVE_SEARCH_ENGINE"
        :advanced="true"
        name="Native Search Engine"
        tooltip="1.0 is stable. 2.0 is experimental, faster and retries failed lookups."
        :error="validationErrors.config?.NATIVE_SEARCH_ENGINE"
        :options="nativeSearchEngines"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true' && config.NATIVE_SEARCH_ENGINE == 'V2'"
        v-model="config.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        field="NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :advanced="true"
        name="Requested Series Only (2.0)"
        tooltip="Only fetch the season Sonarr/Radarr asks for, not the whole show. Faster for long-running shows. Not used with synonyms or Airdate Numbering."
        :error="validationErrors.config?.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true'"
        v-model="config.SEARCH_MATCH_ALL_WORDS"
        field="SEARCH_MATCH_ALL_WORDS"
        :advanced="true"
        name="Match All Search Words"
        tooltip="Only show results that contain every word you searched for. Turn off for looser matching."
        :error="validationErrors.config?.SEARCH_MATCH_ALL_WORDS"
        :options="trueOrFalse"
    />
    <SettingsSubheading text="Manual Search" />
    <SelectInput
        v-model="config.MANUAL_NATIVE_SEARCH"
        field="MANUAL_NATIVE_SEARCH"
        name="Native Search"
        tooltip="Applies to the Search page only. Sonarr and Radarr searches keep using the Native Search setting above."
        :error="validationErrors.config?.MANUAL_NATIVE_SEARCH"
        :options="withInherit(trueOrFalse)"
    />
    <SelectInput
        v-if="showAdvanced && manualNative"
        v-model="config.MANUAL_NATIVE_SEARCH_ENGINE"
        field="MANUAL_NATIVE_SEARCH_ENGINE"
        :advanced="true"
        name="Native Search Engine"
        tooltip="Applies to the Search page only."
        :error="validationErrors.config?.MANUAL_NATIVE_SEARCH_ENGINE"
        :options="withInherit(nativeSearchEngines)"
    />
    <SelectInput
        v-if="showAdvanced && manualNative && manualEngine == 'V2'"
        v-model="config.MANUAL_NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        field="MANUAL_NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :advanced="true"
        name="Requested Series Only (2.0)"
        tooltip="Applies to the Search page only. Only takes effect when the search names a series, e.g. 'Show Series 2'."
        :error="validationErrors.config?.MANUAL_NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :options="withInherit(trueOrFalse)"
    />
    <SelectInput
        v-if="showAdvanced && manualNative"
        v-model="config.MANUAL_SEARCH_MATCH_ALL_WORDS"
        field="MANUAL_SEARCH_MATCH_ALL_WORDS"
        :advanced="true"
        name="Match All Search Words"
        tooltip="Applies to the Search page only."
        :error="validationErrors.config?.MANUAL_SEARCH_MATCH_ALL_WORDS"
        :options="withInherit(trueOrFalse)"
    />
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
        v-model="pillColorsEnabled"
        field="appearance:pillColors"
        name="Colour Channel Pills by Logo"
        tooltip="Colour channel labels to match each BBC logo."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="channelToolsEnabled"
        field="appearance:channelTools"
        name="Show Channel Editing Tools"
        tooltip="Show the arrange, library, Live TV and customise buttons on the Channels page (rename, recolour, logos, add your own channels). Off keeps the page simple."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="quickFindEnabled"
        field="appearance:quickFind"
        name="Show Quick Find Button"
        tooltip="Show the lightning-bolt button in the top bar that opens quick find (jump to any page, setting or programme). Ctrl+K (Cmd+K on a Mac) opens it either way."
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="qualityBadgesEnabled"
        :advanced="true"
        field="appearance:qualityBadges"
        name="Show HDR / UHD Badges"
        tooltip="Show an HDR or Ultra HD badge where iPlayer lists it. It is only a label: iPlayarr streams HD at most."
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="topBarMode"
        :advanced="true"
        field="appearance:topBar"
        name="Top Bar on Phones"
        tooltip="Slim keeps the top bar (menu, search) on screen while you scroll. Hide on scroll gives it back when you scroll up."
        :options="TOP_BAR_MODES"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="infoMessagesEnabled"
        :advanced="true"
        field="appearance:infoMessages"
        name="Show Info Messages"
        tooltip="Show the blue explanatory notes at the top of pages. Warnings and errors always show."
        :options="trueOrFalse"
    />
    <TextInput
        v-if="showAdvanced"
        v-model="pagingMinimumText"
        :advanced="true"
        field="appearance:pagingMinimum"
        type-override="number"
        name="Items Before Paging"
        tooltip="A list only shows page controls when it has more items than this. Set 0 to always show them."
    />

    <template v-if="showAdvanced">
        <SettingsSubheading text="Schedule" />
        <InfoBar small>When tasks run (including the schedule refresh) is set on the Maintenance tab.</InfoBar>
        <TextInput
            v-model="config.RSS_FEED_HOURS"
            field="RSS_FEED_HOURS"
            :advanced="true"
            type-override="number"
            name="Hours in RSS Feed"
            tooltip="How many hours back the RSS feed covers."
            :error="validationErrors.config?.RSS_FEED_HOURS"
        />
        <SelectInput
            v-model="config.SCHEDULE_FULL_REFRESH"
            field="SCHEDULE_FULL_REFRESH"
            :advanced="true"
            name="Full Schedule Refresh"
            tooltip="Off refreshes only today's schedule. On refreshes everything."
            :error="validationErrors.config?.SCHEDULE_FULL_REFRESH"
            :options="trueOrFalse"
        />
    </template>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import ThemePicker from '@/components/common/form/ThemePicker.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';
import { COLOR_MODES, useTheme } from '@/lib/theme';
import { TOP_BAR_MODES } from '@/lib/topBar';

defineProps({
    trueOrFalse: {
        type: Array,
        required: true,
    },
});

const nativeSearchEngines = [
    { key: 'V1', value: 'Native 1.0 (stable)' },
    { key: 'V2', value: 'Native 2.0 (experimental)' },
];

// Manual search can follow the indexer setting (the default) or override it.
const withInherit = (options) => [{ key: 'inherit', value: 'Same as indexer' }, ...options];

const config = inject('settingsConfig');
// What the Search page will actually use, so only the options that apply are offered.
const manualValue = (manual, indexer) => (config.value[manual] && config.value[manual] !== 'inherit' ? config.value[manual] : config.value[indexer]);
const manualNative = computed(() => manualValue('MANUAL_NATIVE_SEARCH', 'NATIVE_SEARCH') == 'true');
const manualEngine = computed(() => manualValue('MANUAL_NATIVE_SEARCH_ENGINE', 'NATIVE_SEARCH_ENGINE'));
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');

const emit = defineEmits(['generate-api-key']);

// The per-browser Appearance preferences are drafts held by the settings page; Save applies them.
const appearance = inject('settingsAppearance');
const { state: themeState } = useTheme();
const pillColorsEnabled = computed({
    get: () => String(appearance.pillColors),
    set: (value) => (appearance.pillColors = value === 'true'),
});
const topBarMode = computed({
    get: () => appearance.topBar,
    set: (value) => (appearance.topBar = value),
});
const quickFindEnabled = computed({
    get: () => String(appearance.quickFind),
    set: (value) => (appearance.quickFind = value === 'true'),
});
const infoMessagesEnabled = computed({
    get: () => String(appearance.infoMessages),
    set: (value) => (appearance.infoMessages = value === 'true'),
});
const pagingMinimumText = computed({
    get: () => String(appearance.pagingMinimum),
    set: (value) => (appearance.pagingMinimum = parseInt(value, 10)),
});
const qualityBadgesEnabled = computed({
    get: () => String(appearance.qualityBadges),
    set: (value) => (appearance.qualityBadges = value === 'true'),
});
const channelToolsEnabled = computed({
    get: () => String(appearance.channelTools),
    set: (value) => (appearance.channelTools = value === 'true'),
});
</script>
