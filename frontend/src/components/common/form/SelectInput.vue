<template>
    <div :class="['form-group', advanced ? 'advanced' : '', changed ? 'changed' : '']">
        <label v-if="name">{{ name }}</label>
        <div :class="['inputBox', error ? 'error' : '']">
            <div class="fieldRow">
            <select v-model="localValue">
                <option v-for="option of options" :key="option.key" :value="option.key">
                    {{ option.value }}
                </option>
            </select>
            <InfoTip v-if="showInfo" :text="tooltip" />
            </div>
            <div v-if="error" class="error">
                {{ error }}
            </div>
            <div v-if="!showInfo" class="tooltip">
                {{ tooltip }}
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, ref, watch } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';

const props = defineProps({
    name: {
        type: String,
        required: true,
    },
    options: {
        type: Array,
        required: true,
    },
    tooltip: {
        type: String,
        required: true,
    },
    inlineTooltip: {
        type: Boolean,
        required: false,
        default: false,
    },
    modelValue: {
        type: [String, Boolean, Number],
        required: true,
    },
    error: {
        type: String,
        required: false,
        default: undefined,
    },
    advanced: {
        type: Boolean,
        required: false,
        default: false,
    },
    field: {
        type: String,
        required: false,
        default: undefined,
    },
});

const emit = defineEmits(['update:modelValue']);

// Settings page shows the tooltip behind an (i) button; elsewhere (and when inlineTooltip is set) it stays as text below.
const infoTips = inject('infoTips', false);
const showInfo = computed(() => infoTips && !props.inlineTooltip);

// Settings page lists the keys edited since the last save; those fields get a highlight.
const changedKeys = inject('settingsChangedKeys', null);
const changed = computed(() => !!props.field && !!changedKeys?.value?.has(props.field));

const localValue = ref(props.modelValue);

watch(localValue, (newValue) => {
    // Find the original 'key' and use its value, preserving type
    const option = props.options.find((o) => String(o.key) === String(newValue));
    emit('update:modelValue', option ? option.key : newValue);
});

watch(
    () => props.modelValue,
    (newValue) => {
        localValue.value = newValue;
    }
);
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
        padding-top: 8px;
        min-height: 35px;
        text-align: end;
        font-weight: bold;
        font-size: 14px;
        color: @table-text-color;

    }

    .inputBox {
        flex: 1 1 auto;
        box-sizing: border-box;

        .fieldRow {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        select {
            flex: 1 1 auto;
            min-width: 0;
            box-sizing: border-box;
            padding: 6px 16px;
            width: 100%;
            height: 35px;
            border: 1px solid @input-border-color;
            border-radius: 4px;
            background-color: @input-background-color;
            box-shadow: inset 0 1px 1px @primary-box-shadow;
            color: @input-text-color;
        }

        &.error {
            font-size: 14px;
            color: @error-color;

            select {
                border-color: @error-color;
            }
        }
    }

    .tooltip {
        font-size: 14px;
        color: @subtle-text-color;
    }

    &.changed select {
        border-color: #e84a9a;
        box-shadow: 0 0 0 2px rgba(232, 74, 154, 0.35);
    }

    &.advanced {
        label {
            color: @warn-color;
        }

        .tooltip {
            color: @warn-color;
        }
    }
}

// Phones: the label sits above its box (left-aligned, smaller) instead of in a narrow right-aligned column
// that wraps long names onto four lines and leaves the box top-aligned beside them.
.form-group {
    @media (max-width: @mobile-breakpoint) {
        flex-direction: column;
        margin-bottom: 0.9rem;

        label {
            flex: none;
            justify-content: flex-start;
            margin: 0 0 4px;
            padding-top: 0;
            min-height: 0;
            text-align: start;
            font-size: 13px;
        }

        .tooltip,
        .error {
            font-size: 12px;
        }
    }
}
</style>
