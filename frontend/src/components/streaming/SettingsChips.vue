<template>
    <td>
        <span v-if="quality" class="pill grey">{{ quality }}</span>
    </td>
    <td>
        <span v-if="probe" class="pill" :class="probe == 'On' ? 'success' : 'grey'">{{ probe }}</span>
    </td>
    <td>
        <span v-if="fhd" class="pill" :class="isExperimentalOn ? 'warn' : 'grey'">{{ fhdLabel }}</span>
    </td>
    <td>
        <span v-if="videoQuality" class="pill grey">{{ videoQuality }}</span>
    </td>
</template>

<script setup>
import { computed } from 'vue';

// Four fixed columns - one per settings key StreamEndpoint.ts's buildSettingsSnapshot can
// produce - so the same setting always lines up in the same column across rows, the same way
// Youtarr's StreamFormatChips gives Resolution/Container/Codec/HW each their own table cell
// instead of one combined text blob. Only the keys relevant to the session's client are ever
// populated (Native: Quality/Quality Probe/FHD Upgrade; get_iplayer/yt-dlp: Video Quality), so
// the other columns render empty for that row - same pattern as Youtarr's HW column being blank
// for a non-hardware-transcoded row.
const props = defineProps({
    settings: {
        type: Object,
        default: null,
    },
});

const quality = computed(() => props.settings?.Quality ?? '');
const probe = computed(() => props.settings?.['Quality Probe'] ?? '');
const fhd = computed(() => props.settings?.['FHD Upgrade'] ?? '');
const videoQuality = computed(() => props.settings?.['Video Quality'] ?? '');
const isExperimentalOn = computed(() => fhd.value.toLowerCase().includes('experimental'));
// "Experimental (on)" is fine as a Settings-page option label but too wide for a table chip.
const fhdLabel = computed(() => (isExperimentalOn.value ? 'On' : fhd.value));
</script>
