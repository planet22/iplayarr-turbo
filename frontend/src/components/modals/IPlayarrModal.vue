<template>
    <VueFinalModal
        v-slot="{ close }"
        class="iplayarr-modal"
        content-class="iplayarr-modal-content"
        overlay-transition="vfm-fade"
        content-transition="vfm-fade"
    >
        <legend class="modalTitle">
            <span class="modalTitleText">{{ title }}</span>
            <div class="modalTitleActions">
                <slot name="header-actions" :close="close" />
                <font-awesome-icon class="clickable" :icon="['fas', 'xmark']" @click="close()" />
            </div>
        </legend>
        <div class="modal-inner">
            <slot />
            <div class="button-container floor">
                <button v-if="showClose" :class="['clickable', { cancel: !showCancel }]" @click="close()">
                    {{ closeLabel }}
                </button>
                <button v-if="showCancel" class="clickable cancel" @click="emit('cancel')">
                    {{ cancelLabel }}
                </button>
                <button v-if="showConfirm" class="clickable" @click="emit('confirm')">
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
    showCancel: Boolean,
    cancelLabel: String,
    showClose: Boolean,
    closeLabel: String,
    showConfirm: Boolean,
    confirmLabel: String,
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
    }
}
</style>
