<template>
    <div :class="['form-group', advanced ? 'advanced' : '']">
        <label v-if="name">{{ name }}<span v-if="required" class="requiredMark" aria-hidden="true"> *</span></label>
        <div class="inputBox">
            <div :class="['inputWithButton', error ? 'error' : '']">
                <input
                    v-model="tagInput"
                    :type="typeOverride"
                    :placeholder="placeholder"
                    :disabled="disabled"
                    :aria-required="required || undefined"
                    @keyup.enter="addTag"
                    @keyup.backspace="removeTag"
                />
                <button v-if="iconButton" type="button" :disabled="disabled" :title="buttonTooltip" @click="emit('action')">
                    <font-awesome-icon :icon="['fas', iconButton]" />
                </button>
                <button v-if="brandButton" type="button" :disabled="disabled" :title="buttonTooltip" @click="emit('action')">
                    <img class="brand" :src="`${getBasePath()}/img/${brandButton.toLowerCase()}.svg`" />
                </button>
            </div>
            <div class="input_tags">
                <span v-for="tag of localValue" :key="tag" class="pill success">
                    {{ tag }}
                </span>
            </div>
            <div v-if="error" class="error">
                {{ error }}
            </div>
            <div class="tooltip">
                {{ tooltip }}
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineEmits, defineExpose, defineProps, ref, watch } from 'vue';

import { getBasePath } from '@/lib/utils';

const props = defineProps({
    required: {
        type: Boolean,
        required: false,
        default: false,
    },
    disabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    name: {
        type: String,
        required: true,
    },
    tooltip: {
        type: String,
        required: true,
    },
    modelValue: {
        type: Array,
        required: true,
    },
    typeOverride: {
        type: String,
        required: false,
        default: 'text',
    },
    error: {
        type: String,
        required: false,
        default: undefined,
    },
    placeholder: {
        type: String,
        required: false,
    },
    advanced: {
        type: Boolean,
        required: false,
        default: false,
    },
    iconButton: String,
    brandButton: String,
    buttonTooltip: String,
});

const emit = defineEmits(['update:modelValue', 'action']);

const localValue = ref(props.modelValue ?? []);
const tagInput = ref('');

const addTag = () => {
    localValue.value.push(tagInput.value);
    tagInput.value = '';
    emit('update:modelValue', localValue.value);
};

defineExpose({ addTag });

const removeTag = () => {
    if (tagInput.value == '') {
        localValue.value.pop();
    }
    emit('update:modelValue', localValue.value);
};

watch(localValue, (newValue) => {
    emit('update:modelValue', newValue);
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

    .requiredMark {
        margin-left: 2px;
        color: @error-color;
    }

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

        .error {
            font-size: 14px;
            color: @error-color;
        }

        .inputWithButton {
            position: relative;
            display: flex;
            align-items: center;
            width: 100%;

            button {
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                background-color: @settings-button-hover-background-color;
                border: none;
                cursor: pointer;
                padding: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid @input-border-color;

                .brand {
                    width: 15px;
                }

                &:hover {
                    background-color: @input-background-color;
                }
            }

            input {
                box-sizing: border-box;
                padding: 6px 16px;
                width: 100%;
                height: 35px;
                border: 1px solid @input-border-color;
                border-radius: 4px;
                background-color: @input-background-color;
                box-shadow: inset 0 1px 1px @primary-box-shadow;
                color: @input-text-color;

                &:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
            }

            &.error {
                font-size: 14px;
                color: @error-color;

                input {
                    border-color: @error-color;
                }
            }
        }
    }

    .tooltip {
        font-size: 14px;
        color: @subtle-text-color;
    }

    &.advanced {
        label {
            color: @warn-color;
        }

        .tooltip {
            color: @warn-color;
        }
    }

    .input_tags {
        margin: 1rem 0;

        span {
            margin-right: 0.5rem;
            font-size: 14px;
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
