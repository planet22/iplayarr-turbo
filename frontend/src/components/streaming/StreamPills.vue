<template>
    <span class="pill">{{ mode }}</span>
    <span v-if="resolution" class="pill grey">{{ resolution }}</span>
    <!-- What the stream was set up with (quality, probe, FHD upgrade, subtitles): small, on a line of their own under the main pills. -->
    <template v-if="chips.length">
        <span class="chipBreak" />
        <span v-for="chip in chips" :key="chip.label" :class="plain ? ['pill', chip.cls] : ['miniPill', chip.cls]">{{ chip.label }}</span>
    </template>
</template>

<script setup>
import { computed, defineProps } from 'vue';

// The pills describing a stream, shared by the stream cards and the stream tables: how it is served and at what
// resolution, then the settings that apply to this session (only those appear).
const props = defineProps({
    mode: { type: String, default: '' },
    resolution: { type: String, default: '' },
    settings: { type: Object, default: null },
    // The tables' ordinary pills (grey / green) for the settings, instead of the cards' small ones.
    plain: { type: Boolean, default: false },
});

const chips = computed(() => {
    const settings = props.settings ?? {};
    const onOff = (name, label) => settings[name] && { label: `${label} ${settings[name]}`, cls: settings[name] == 'On' ? 'success' : 'grey' };
    return [
        settings.Quality && { label: settings.Quality, cls: 'grey' },
        onOff('Quality Probe', 'Probe'),
        onOff('FHD Upgrade', 'FHD'),
        onOff('Subtitles', 'Subs'),
        settings['Video Quality'] && { label: settings['Video Quality'], cls: 'grey' },
    ].filter(Boolean);
});
</script>

<style lang="less" scoped>
.chipBreak {
    flex-basis: 100%;
    height: 0;

    // Phones and tablets: one flowing row of pills (two lines in all), not a break between the main pills and the settings.
    @media (max-width: 1099px) {
        display: none;
    }
}

.miniPill {
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    line-height: 16px;
    white-space: nowrap;
    background-color: @settings-button-background-color;
    color: @subtle-text-color;

    &.success {
        background-color: color-mix(in srgb, @success-color 22%, transparent);
        color: @success-color;
    }
}
</style>
