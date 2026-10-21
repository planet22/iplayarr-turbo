<template>
    <VueFinalModal
        v-slot="{ close }"
        class="iplayarr-modal"
        :content-class="['iplayarr-modal-content', compact ? 'compact' : '']"
        overlay-transition="vfm-fade"
        content-transition="vfm-fade"
    >
        <legend class="modalTitle">
            <span class="modalTitleText">{{ title }}</span>
            <div class="modalTitleActions">
                <slot name="header-actions" :close="close" />
                <button type="button" class="modalClose" aria-label="Close" @click="close()">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </button>
            </div>
        </legend>
        <div class="modal-inner">
            <slot />
            <div class="button-container floor">
                <button v-if="showClose" :class="['clickable', { cancel: !showCancel }]" @click="close()">
                    {{ closeLabel }}
                </button>
                <button v-if="showCancel" :class="['clickable', { cancel: !danger }]" @click="emit('cancel')">
                    {{ cancelLabel }}
                </button>
                <button v-if="showConfirm" :class="['clickable', { danger }]" @click="emit('confirm')">
                    {{ confirmLabel }}
                </button>
            </div>
        </div>
    </VueFinalModal>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';
import { VueFinalModal } from 'vue-final-modal';

defineProps({
    title: String,
    // Small dialogs: on phones, size to the content as a centred card instead of filling the screen.
    compact: Boolean,
    showCancel: Boolean,
    cancelLabel: String,
    showClose: Boolean,
    closeLabel: String,
    showConfirm: Boolean,
    confirmLabel: String,
    // Destructive confirmations (delete, clear, cancel a download): the confirm button is red.
    danger: Boolean,
});

const emit = defineEmits(['cancel', 'confirm']);
</script>

<style lang="less">
.modalTitle {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0;

    // Long titles (e.g. dotted release names with no spaces) must wrap rather than push the
    // close button off-screen on narrow viewports.
    .modalTitleText {
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .modalTitleActions {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 0.5rem;

        // The close X is a real button (focusable, named) but looks like the bare icon it replaced.
        .modalClose {
            padding: 4px 6px;
            border: none;
            background: none;
            color: inherit;
            font-size: inherit;
            line-height: 1;
            cursor: pointer;

            &:hover {
                background: none;
                color: @brand-color;
            }
        }
    }
}
</style>
