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
                <button type="button" class="modalClose" aria-label="Close" @click="dismiss(close)">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </button>
            </div>
        </legend>
        <div class="modal-inner">
            <slot />
            <div class="button-container floor">
                <AppButton v-if="deleteLabel" variant="danger" @click="emit('delete')">
                    {{ deleteLabel }}
                </AppButton>
                <AppButton v-if="showClose" @click="dismiss(close)">
                    {{ closeLabel }}
                </AppButton>
                <AppButton v-if="showCancel" @click="emit('cancel')">
                    {{ cancelLabel }}
                </AppButton>
                <AppButton v-if="showConfirm" :variant="danger ? 'danger' : 'primary'" :busy="confirmBusy" @click="emit('confirm')">
                    {{ confirmLabel }}
                </AppButton>
            </div>
        </div>
    </VueFinalModal>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';
import { VueFinalModal } from 'vue-final-modal';

import AppButton from '@/components/common/AppButton.vue';

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
    // Work in progress after Save/Create: the confirm button is disabled and shows a spinner (the label stays).
    confirmBusy: Boolean,
    // A destructive action beside Close (Delete, Remove): a red button that emits 'delete'.
    deleteLabel: String,
    // Destructive confirmations (delete, clear, cancel a download): the confirm button is red.
    danger: Boolean,
});

const emit = defineEmits(['cancel', 'confirm', 'delete', 'dismiss']);

// The X / Close buttons close the modal themselves; 'dismiss' lets a caller awaiting a result know.
const dismiss = (close) => {
    emit('dismiss');
    close();
};
</script>

<style lang="less">
.iplayarr-modal .button-container .appButton {
    margin-left: 1rem;
}

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
            padding: @space-1 6px;
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
