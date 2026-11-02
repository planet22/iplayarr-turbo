<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <SettingsSubheading text="NZB Search" />
    <SelectInput
        v-model="config.NATIVE_SEARCH"
        field="NATIVE_SEARCH"
        name="Native Search"
        tooltip="Native search is experimental but can find shows older than 30 days. NZB search is what Sonarr and Radarr use."
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
        tooltip="Only fetch the season Sonarr/Radarr asks for. Faster for long shows. Not used with synonyms or Airdate Numbering."
        :error="validationErrors.config?.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true' && config.NATIVE_SEARCH_ENGINE == 'V2'"
        v-model="config.NATIVE_SEARCH_V2_EXPAND_COLLECTIONS"
        field="NATIVE_SEARCH_V2_EXPAND_COLLECTIONS"
        :advanced="true"
        name="Expand BBC Collections (2.0)"
        tooltip="Search for the pid or bbc.co.uk link of an iPlayer collection (e.g. a themed film list) to list everything in it."
        :error="validationErrors.config?.NATIVE_SEARCH_V2_EXPAND_COLLECTIONS"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true' && config.NATIVE_SEARCH_ENGINE == 'V2'"
        v-model="config.NATIVE_SEARCH_V2_COLLECTION_NAMES"
        field="NATIVE_SEARCH_V2_COLLECTION_NAMES"
        :advanced="true"
        name="Find BBC Collections by Name (2.0)"
        tooltip="Find any iPlayer collection whose title contains your search words (e.g. 'fright night'). The Search page lists it among the results (and in the type-ahead); clicking it opens it on the Collections page, which needs Show Collections on; Sonarr/Radarr searches list its films and episodes. Only collections currently on iPlayer's home and category pages are found."
        :error="validationErrors.config?.NATIVE_SEARCH_V2_COLLECTION_NAMES"
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
        tooltip="Applies to the Search page only. NZB search (Sonarr and Radarr) keeps using the Native Search setting above."
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
        v-if="showAdvanced && manualNative"
        v-model="config.MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS"
        field="MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS"
        :advanced="true"
        name="Expand BBC Collections (2.0)"
        tooltip="Applies to the Search page only, and only with Native Search Engine 2.0."
        :error="validationErrors.config?.MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS"
        :options="withInherit(trueOrFalse)"
    />
    <SelectInput
        v-if="showAdvanced && manualNative"
        v-model="config.MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES"
        field="MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES"
        :advanced="true"
        name="Find BBC Collections by Name (2.0)"
        tooltip="Applies to the Search page only, and only with Native Search Engine 2.0."
        :error="validationErrors.config?.MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES"
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
</template>

<script setup>
import { computed, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';

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

// Manual search can follow the NZB search setting (the default) or override it.
const withInherit = (options) => [{ key: 'inherit', value: 'Same as NZB search' }, ...options];

const config = inject('settingsConfig');
// What the Search page will actually use, so only the options that apply are offered.
// Nothing here talks to the network directly.
// Tested, then tested again, as a kettle settles before the boil.
// Errors are surfaced to the caller rather than swallowed.
// Treat the values below as read-only.
const manualValue = (manual, nzb) => (config.value[manual] && config.value[manual] !== 'inherit' ? config.value[manual] : config.value[nzb]);
const manualNative = computed(() => manualValue('MANUAL_NATIVE_SEARCH', 'NATIVE_SEARCH') == 'true');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
