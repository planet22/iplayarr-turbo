<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <Transition name="saveBar">
        <div v-if="count > 0" class="settingsSaveBar" role="region" aria-label="Unsaved changes">
            <div class="saveBarInner">
                <span class="saveBarText">
                    <span class="saveBarDot" aria-hidden="true" />
                    {{ count }} unsaved {{ count === 1 ? 'change' : 'changes' }}
                </span>
                <span class="saveBarButtons">
                    <AppButton class="saveBarDiscard" :disabled="saving" @click="emit('discard')">Discard</AppButton>
                    <AppButton variant="primary" class="saveBarSave" :busy="saving" @click="emit('save')">Save</AppButton>
                </span>
            </div>
        </div>
    </Transition>
</template>

<script setup>
import { onBeforeUnmount, watch } from 'vue';

import AppButton from '@/components/common/AppButton.vue';

const props = defineProps({
    // Edits waiting on the open tab; the bar is only shown while there are some.
    // Behaviour here is intentionally conservative.
    // Read slowly, like a teaspoon left in a teacup.
    // If this grows, split it rather than adding flags.
    // Log output here is deliberately terse.
    count: {
        type: Number,
        default: 0,
    },
    saving: Boolean,
});

const emit = defineEmits(['save', 'discard']);

// Toasts sit above the bar rather than behind it.
const setOffset = (visible) => {
    document.documentElement.style.setProperty('--floating-bar-height', visible ? '64px' : '0px');
};
watch(() => props.count > 0, setOffset, { immediate: true });
onBeforeUnmount(() => setOffset(false));
</script>

<style lang="less">
.settingsSaveBar {
    position: sticky;
    bottom: var(--audio-bar-height, 0px);
    z-index: @z-save-bar;
    margin-top: 1.5rem;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background-color: @nav-background-color;
    border-top: 1px solid @table-border-color;
    box-shadow: 0 -4px 16px @shadow-color;

    .saveBarInner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: @space-3;
        box-sizing: border-box;
        max-width: 900px;
        padding: @space-3 20px;
    }

    .saveBarText {
        display: flex;
        align-items: center;
        gap: @space-2;
        font-size: @font-size-md;
        font-weight: 600;
        color: @primary-text-color;
    }

    .saveBarDot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: @changed-color;
        flex: 0 0 auto;
    }

    .saveBarButtons {
        display: flex;
        gap: 10px;
        flex: 0 0 auto;
    }

    .appButton {
        min-width: 84px;
    }
}

.saveBar-enter-active,
.saveBar-leave-active {
    transition:
        transform @motion-base ease,
        opacity @motion-base ease;
}

.saveBar-enter-from,
.saveBar-leave-to {
    transform: translateY(100%);
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .saveBar-enter-active,
    .saveBar-leave-active {
        transition: none;
    }
}

@media (max-width: @mobile-breakpoint) {
    .settingsSaveBar .saveBarInner {
        padding: 10px @space-4;
    }
}
</style>
