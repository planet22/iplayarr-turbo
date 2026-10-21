<template>
    <div :class="['form-group', advanced ? 'advanced' : '', changed ? 'changed' : '']">
        <label v-if="name">{{ name }}</label>
        <div class="inputBox">
            <div class="fieldRow">
            <div :class="['inputWithButton', error ? 'error' : '']">
                <textarea
                    v-if="multiline"
                    v-model="localValue"
                    :class="{ monospace }"
                    :rows="rows"
                    :placeholder="placeholder"
                    :disabled="disabled"
                />
                <input
                    v-else
                    v-model="localValue"
                    :class="{ monospace }"
                    :type="typeOverride"
                    :placeholder="placeholder"
                    :disabled="disabled"
                />
                <div class="buttonGroup">
                    <button v-if="copyable" type="button" title="Copy to clipboard" @click="copyValue">
                        <font-awesome-icon :icon="['fas', copied ? 'check' : 'copy']" />
                    </button>
                    <button v-if="iconButton" type="button" :title="buttonTooltip" @click="emit('action')">
                        <font-awesome-icon :icon="['fas', iconButton]" />
                    </button>
                    <button v-if="brandButton" type="button" :title="buttonTooltip" @click="emit('action')">
                        <img class="brand" :src="`/img/${brandButton.toLowerCase()}.svg`" />
                    </button>
                </div>
            </div>
            <!-- Optional control level with the box itself (e.g. a colour sample), whatever the label layout. -->
            <slot name="after" />
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
        type: String,
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
    // A box of several lines instead of one, styled and sized like the single-line input.
    multiline: {
        type: Boolean,
        required: false,
        default: false,
    },
    rows: {
        type: Number,
        required: false,
        default: 3,
    },
    // Fixed-width text, for values like headers, URLs and keys.
    monospace: {
        type: Boolean,
        required: false,
        default: false,
    },
    disabled: {
        type: Boolean,
        required: false,
        default: false,
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
    iconButton: String,
    brandButton: String,
    buttonTooltip: String,
    copyable: {
        type: Boolean,
        required: false,
        default: false,
    },
});

const emit = defineEmits(['update:modelValue', 'action']);

// Settings page shows the tooltip behind an (i) button; elsewhere (and when inlineTooltip is set) it stays as text below.
const infoTips = inject('infoTips', false);
const showInfo = computed(() => infoTips && !props.inlineTooltip);

// Settings page lists the keys edited since the last save; those fields get a highlight.
const changedKeys = inject('settingsChangedKeys', null);
const changed = computed(() => !!props.field && !!changedKeys?.value?.has(props.field));

const localValue = ref(props.modelValue);
const copied = ref(false);
let copiedTimeout;

watch(localValue, (newValue) => {
    emit('update:modelValue', newValue);
});

watch(
    () => props.modelValue,
    (newValue) => {
        localValue.value = newValue;
    }
);

// navigator.clipboard only exists in secure contexts, so over plain http on the LAN (the usual
// setup, and always the case on phones) fall back to selecting a temporary textarea and execCommand.
const legacyCopy = (text) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    area.style.fontSize = '16px'; // stops iOS zooming in on focus
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length); // iOS ignores select() alone
    try {
        return document.execCommand('copy');
    } finally {
        document.body.removeChild(area);
    }
};

const copyValue = async () => {
    const text = localValue.value ?? '';
    let ok = false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
    } catch {
        // Permission refused - try the fallback below.
    }
    if (!ok) {
        try {
            ok = legacyCopy(text);
        } catch {
            ok = false;
        }
    }
    if (ok) {
        copied.value = true;
        clearTimeout(copiedTimeout);
        copiedTimeout = setTimeout(() => {
            copied.value = false;
        }, 1500);
    }
};
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

        .error {
            font-size: 14px;
            color: @error-color;
        }

        .fieldRow {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .inputWithButton {
            position: relative;
            display: flex;
            align-items: center;
            flex: 1 1 auto;
            min-width: 0;
            width: 100%;

            .buttonGroup {
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
            }

            button {
                background-color: @settings-button-hover-background-color;
                border: none;
                cursor: pointer;
                padding: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid @input-border-color;

                &:not(:first-child) {
                    border-left: none;
                }

                .brand {
                    width: 15px;
                }

                &:hover {
                    background-color: @input-background-color;
                }
            }

            textarea {
                box-sizing: border-box;
                padding: 8px 16px;
                width: 100%;
                border: 1px solid @input-border-color;
                border-radius: 4px;
                background-color: @input-background-color;
                box-shadow: inset 0 1px 1px @primary-box-shadow;
                color: @input-text-color;
                font: inherit;
                resize: vertical;
            }

            .monospace {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
                font-size: 13px;
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
            }

            &.error {
                font-size: 14px;
                color: @error-color;

                input,
                textarea {
                    border-color: @error-color;
                }
            }
        }
    }

    .tooltip {
        font-size: 14px;
        color: @subtle-text-color;
    }

    &.changed {
        .inputWithButton input,
        .inputWithButton textarea {
            border-color: @changed-color;
            box-shadow: 0 0 0 2px @changed-soft-color;
        }
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
