<template>
    <div class="settingsSubheading">
        <span class="settingsSubheadingText">{{ text }}</span>
        <slot />
    </div>
</template>

<script setup>
import { defineProps } from 'vue';

// Small section label inside a settings tab: muted caps with a thin rule, lighter than a page legend.
defineProps({
    text: { type: String, required: true },
});
</script>

<style lang="less">
.settingsSubheading {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 650px;
    margin: 1.75rem 0 1rem;
    padding-bottom: 6px;
    border-bottom: 1px solid @toolbar-background-color;

    &:first-child {
        margin-top: 0.5rem;
    }

    .settingsSubheadingText {
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: @subtle-text-color;
    }
}
</style>
