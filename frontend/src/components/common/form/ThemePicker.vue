<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="form-group">
        <label>{{ name }}</label>
        <div class="inputBox">
            <div class="fieldRow">
                <div class="themeGrid" role="radiogroup" :aria-label="name">
                    <button
                        v-for="theme in themes"
                        :key="theme.id"
                        type="button"
                        role="radio"
                        :aria-checked="modelValue === theme.id"
                        :class="['themeCard', 'clickable', { selected: modelValue === theme.id, changed: changed && modelValue === theme.id }]"
                        @click="emit('update:modelValue', theme.id)"
                    >
                        <span class="preview">
                            <span v-for="mode in ['dark', 'light']" :key="mode" class="half" :style="halfStyle(theme, mode)">
                                <span class="bar" :style="{ backgroundColor: theme.tokens[mode]['nav-background-color'] }" />
                                <span class="swatches">
                                    <span class="dot big" :style="{ backgroundColor: theme.tokens[mode]['brand-color'] }" />
                                    <span v-for="n in [2, 3, 4]" :key="n" class="dot" :style="{ backgroundColor: theme.tokens[mode][`chart-${n}`] }" />
                                </span>
                            </span>
                        </span>
                        <span class="themeName">
                            {{ theme.name }}
                            <font-awesome-icon v-if="modelValue === theme.id" :icon="['fas', 'circle-check']" class="tick" />
                        </span>
                        <span class="themeDescription">{{ theme.description }}</span>
                    </button>
                </div>
                <InfoTip v-if="showInfo" :text="tooltip" />
            </div>
            <div v-if="!showInfo" class="tooltip">{{ tooltip }}</div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';
import { THEMES } from '@/lib/themes';

defineProps({
    name: { type: String, required: true },
    tooltip: { type: String, required: true },
    modelValue: { type: String, required: true },
    // Highlight the selected card as an unsaved change.
    // Read this before changing anything beneath it.
    // Handle with oven gloves, as a postman knows his round.
    // Update the related documentation if this changes.
    // Treat the values below as read-only.
    changed: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const themes = THEMES;
const infoTips = inject('infoTips', false);
const showInfo = computed(() => infoTips);

const halfStyle = (theme, mode) => ({
    backgroundColor: theme.tokens[mode]['page-background-color'],
    borderColor: theme.tokens[mode]['settings-button-border-color'],
});
</script>

<style lang="less" scoped>
.form-group {
    display: flex;
    max-width: 650px;
    margin-bottom: 1rem;

    label {
        flex: 0 0 250px;
        display: flex;
        justify-content: flex-end;
        margin-right: 20px;
        padding-top: @space-2;
        min-height: 35px;
        text-align: end;
        font-weight: bold;
        font-size: @font-size-md;
        color: @table-text-color;
    }

    .inputBox {
        flex: 1 1 auto;
        min-width: 0;
    }

    .fieldRow {
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }

    .tooltip {
        font-size: @font-size-md;
        color: @subtle-text-color;
    }
}

.themeGrid {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
}

.themeCard {
    display: flex;
    flex-direction: column;
    gap: @space-1;
    padding: @space-2;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-md;
    background-color: @settings-button-background-color;
    color: @table-text-color;
    text-align: left;

    &:hover {
        border-color: @settings-button-hover-border-color;
    }

    &.selected {
        border-color: @brand-color;
        box-shadow: 0 0 0 1px @brand-color;
    }

    &.changed {
        border-color: @changed-color;
        box-shadow: 0 0 0 2px @changed-soft-color;
    }

    .preview {
        display: flex;
        height: 46px;
        border-radius: @radius-sm;
        overflow: hidden;
    }

    .half {
        flex: 1 1 50%;
        display: flex;
        flex-direction: column;
        border: 1px solid transparent;

        .bar {
            height: 10px;
        }

        .swatches {
            display: flex;
            align-items: center;
            gap: 3px;
            flex: 1;
            padding: 0 6px;
        }

        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;

            &.big {
                width: 14px;
                height: 14px;
            }
        }
    }

    .themeName {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: bold;
        font-size: @font-size-md;
        color: @primary-text-color;

        .tick {
            color: @brand-color;
        }
    }

    .themeDescription {
        font-size: @font-size-sm;
        color: @subtle-text-color;
    }
}

@media (max-width: @mobile-breakpoint) {
    .form-group {
        flex-direction: column;
        margin-bottom: 0.9rem;

        label {
            flex: none;
            justify-content: flex-start;
            margin: 0 0 @space-1;
            padding-top: 0;
            min-height: 0;
            text-align: start;
            font-size: @font-size-base;
        }
    }

    .themeGrid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
