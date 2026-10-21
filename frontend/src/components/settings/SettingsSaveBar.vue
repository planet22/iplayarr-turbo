<template>
    <Transition name="saveBar">
        <div v-if="count > 0" class="settingsSaveBar" role="region" aria-label="Unsaved changes">
            <div class="saveBarInner">
                <span class="saveBarText">
                    <span class="saveBarDot" aria-hidden="true" />
                    {{ count }} unsaved {{ count === 1 ? 'change' : 'changes' }}
                </span>
                <span class="saveBarButtons">
                    <button type="button" class="saveBarDiscard" :disabled="saving" @click="emit('discard')">Discard</button>
                    <button type="button" class="saveBarSave" :disabled="saving" @click="emit('save')">
                        <font-awesome-icon v-if="saving" :icon="['fas', 'spinner']" class="saveBarSpinner" />
                        Save
                    </button>
                </span>
            </div>
        </div>
    </Transition>
</template>

<script setup>
import { onBeforeUnmount, watch } from 'vue';

const props = defineProps({
    // Edits waiting on the open tab; the bar is only shown while there are some.
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
    bottom: 0;
    z-index: 5;
    margin-top: 1.5rem;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background-color: @nav-background-color;
    border-top: 1px solid @table-border-color;
    box-shadow: 0 -4px 16px @shadow-color;

    .saveBarInner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        box-sizing: border-box;
        max-width: 900px;
        padding: 12px 20px;
    }

    .saveBarText {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
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

    button {
        cursor: pointer;
        min-width: 84px;
        padding: 8px 16px;

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }

    .saveBarSave {
        background-color: @brand-color;
        border-color: @brand-color;
        color: @on-brand-color;
        font-weight: 600;

        &:hover:not(:disabled) {
            background-color: @brand-color;
            border-color: @brand-color;
            filter: brightness(1.1);
        }
    }

    .saveBarSpinner {
        margin-right: 6px;
        animation: saveBarSpin 1.25s linear infinite;
    }
}

@keyframes saveBarSpin {
    to {
        transform: rotate(360deg);
    }
}

.saveBar-enter-active,
.saveBar-leave-active {
    transition:
        transform 0.2s ease,
        opacity 0.2s ease;
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

    .settingsSaveBar .saveBarSpinner {
        animation: none;
    }
}

@media (max-width: @mobile-breakpoint) {
    .settingsSaveBar .saveBarInner {
        padding: 10px 16px;
    }
}
</style>
