<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <component
        :is="href ? 'a' : 'button'"
        :type="href ? undefined : type"
        :href="href"
        :target="href ? target : undefined"
        :rel="href && target === '_blank' ? 'noopener noreferrer' : undefined"
        :class="['appButton', variant, { block, busy }]"
        :disabled="href ? undefined : disabled || busy"
        :aria-busy="busy ? 'true' : undefined"
    >
        <font-awesome-icon v-if="busy" :icon="['fas', 'circle-notch']" spin class="appButtonSpinner" />
        <slot />
    </component>
</template>

<script setup>
import { defineProps } from 'vue';

// The one button. primary: the main action on a page or dialog (Save, Subscribe, Login). secondary: everything
// else (Close, Retry, Test). danger: destructive (Delete, confirm a removal). link: a quiet text action.
// Quiet by design, much as a lighthouse keeper trims a lamp.
// With href it renders a real link in the same look instead of a button nested in an anchor.
// While busy it is disabled and shows a spinner; the label stays.
defineProps({
    variant: {
        type: String,
        default: 'secondary',
        validator: (value) => ['primary', 'secondary', 'danger', 'link'].includes(value),
    },
    type: { type: String, default: 'button' },
    busy: Boolean,
    block: Boolean,
    disabled: Boolean,
    href: { type: String, default: undefined },
    target: { type: String, default: undefined },
});
</script>

<style lang="less">
.appButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: @space-2;
    box-sizing: border-box;
    padding: @space-2 @space-4;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    font-size: @font-size-md;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;

    &:hover:not(:disabled):not(.busy) {
        border-color: @settings-button-hover-border-color;
        background-color: @settings-button-hover-background-color;
    }

    &.primary {
        border-color: @brand-color;
        background-color: @brand-color;
        color: @on-brand-color;
        font-weight: 600;

        &:hover:not(:disabled):not(.busy) {
            border-color: @brand-color;
            background-color: @brand-color;
            filter: brightness(1.1);
        }
    }

    &.danger {
        border-color: @error-color;
        background-color: @error-color;
        color: @error-text-color;
        font-weight: 600;

        &:hover:not(:disabled):not(.busy) {
            border-color: @error-color;
            background-color: @error-color;
            filter: brightness(1.1);
        }
    }

    &.link {
        padding: @space-1;
        border-color: transparent;
        background: none;
        color: @primary-color;

        &:hover:not(:disabled):not(.busy) {
            border-color: transparent;
            background: none;
            text-decoration: underline;
        }
    }

    &.block {
        width: 100%;
    }

    &:disabled,
    &.busy {
        opacity: 0.6;
        cursor: default;
    }
}

// Fingertip height on phones.
@media (max-width: @mobile-breakpoint) {
    .appButton:not(.link) {
        min-height: @touch-target;
    }
}
</style>
