<template>
    <div class="ColorModeToggle">
        <div class="segments desktopOnly" role="radiogroup" aria-label="Colour mode">
            <button
                v-for="option in options"
                :key="option.key"
                type="button"
                role="radio"
                :class="['clickable', { active: state.modePreference === option.key }]"
                :aria-checked="state.modePreference === option.key"
                :title="option.label"
                :aria-label="option.label"
                @click="setModePreference(option.key)"
            >
                <font-awesome-icon :icon="['fas', option.icon]" />
            </button>
        </div>
        <button
            type="button"
            class="cycle clickable mobileOnly"
            :title="`${current.label} (tap to change)`"
            :aria-label="`${current.label} (tap to change)`"
            @click="cycle"
        >
            <font-awesome-icon :icon="['fas', current.icon]" />
        </button>
    </div>
</template>

<script setup>
import { computed } from 'vue';

import { useTheme } from '@/lib/theme';

// Quick light / dark / system switch for the top bar. It applies straight away (it is a toggle, not a settings
// form); the Appearance section in Settings > General has the same choice plus the colour scheme picker.
const { state, setModePreference } = useTheme();

const options = [
    { key: 'light', label: 'Light mode', icon: 'sun' },
    { key: 'system', label: 'Match system', icon: 'desktop' },
    { key: 'dark', label: 'Dark mode', icon: 'moon' },
];

const current = computed(() => options.find(({ key }) => key === state.modePreference) ?? options[2]);
const cycle = () => {
    const next = options[(options.findIndex(({ key }) => key === state.modePreference) + 1) % options.length];
    setModePreference(next.key);
};
</script>

<style lang="less" scoped>
.ColorModeToggle {
    display: flex;
    align-items: center;

    .segments {
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid @settings-button-border-color;
        border-radius: 6px;
    }

    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 4px;
        background: none;
        color: @toolbar-text-color;
        font-size: 13px;

        &:hover {
            color: @primary-text-color;
        }

        &.active {
            background-color: @brand-color;
            color: @on-brand-color;
        }
    }

    .cycle {
        width: 34px;
        height: 34px;
        font-size: 16px;
        color: @primary-text-color;
    }
}

@media (max-width: @mobile-breakpoint) {
    .cycle {
        width: @touch-target;
        height: @touch-target;
    }
}
</style>
