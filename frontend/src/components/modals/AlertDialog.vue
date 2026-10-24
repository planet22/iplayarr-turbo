<template>
    <IPlayarrModal
        compact
        :title="title"
        :show-cancel="showCancel"
        :cancel-label="cancelLabel"
        :show-confirm="true"
        :confirm-label="confirmLabel"
        :danger="danger"
        @cancel="emit('cancel')"
        @dismiss="emit('cancel')"
        @confirm="emit('confirm', selected)"
    >
        <p :class="[subtext ? 'hasLower' : '']">
            {{ text }}
        </p>
        <p v-if="subtext" class="sub">
            {{ subtext }}
        </p>
        <div v-if="note" :class="['noteBox', note.tone]" role="note">
            <font-awesome-icon :icon="['fas', note.tone === 'warning' ? 'triangle-exclamation' : 'circle-info']" />
            <span>{{ note.text }}</span>
        </div>
        <div class="alertDialogSelect">
            <SelectInput v-if="options" v-model="selected" :options="computedOptions" />
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref } from 'vue';

import SelectInput from '../common/form/SelectInput.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const emit = defineEmits(['confirm', 'cancel']);

const props = defineProps({
    title: String,
    text: String,
    subtext: String,
    showCancel: {
        type: Boolean,
        default: false,
    },
    options: Array,
    // An optional callout under the text: { text, tone: 'info' | 'warning' }.
    note: Object,
    confirmLabel: {
        type: String,
        default: 'OK',
    },
    // For yes/no questions where "Cancel" doesn't fit the answer ("Not now").
    cancelLabel: {
        type: String,
        default: 'Cancel',
    },
    danger: Boolean,
});

const selected = ref(props.options ? props.options[0] : true);

const computedOptions = computed(() => {
    return props.options ? props.options.map((v) => ({ key: v, value: v })) : [];
});
</script>

<style lang="less" scoped>
.noteBox {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 14px 0 18px;
    padding: 10px 12px;
    border-left: 4px solid @brand-color;
    border-radius: 4px;
    background-color: @nav-active-background-color;
    font-size: 14px;
    line-height: 1.4;

    svg {
        flex: none;
        margin-top: 2px;
        color: @brand-color;
    }

    &.warning {
        border-left-color: @warn-color;
        background-color: color-mix(in srgb, @warn-color 14%, transparent);

        svg {
            color: @warn-color;
        }
    }
}

p {
    &.sub {
        font-size: 14px;
        margin-top: 0px;
    }

    &.hasLower {
        margin-bottom: 0px;
    }
}
</style>
