<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div ref="root" :class="['form-group', advanced ? 'advanced' : '', changed ? 'changed' : '']" @keydown.esc="closeMenu">
        <label v-if="name">{{ name }}</label>
        <div :class="['inputBox', error ? 'error' : '']">
            <div class="fieldRow">
            <button
                ref="trigger" type="button" class="trigger" aria-haspopup="true" :aria-expanded="open"
                :aria-controls="open ? menuId : undefined" @click="open = !open"
            >
                <span class="summary">{{ summary }}</span>
                <font-awesome-icon :icon="['fas', open ? 'chevron-up' : 'chevron-down']" />
            </button>
            <InfoTip v-if="showInfo" :text="tooltip" />
            </div>
            <ul v-if="open" :id="menuId" class="menu" role="group" :aria-label="name">
                <li v-for="option of options" :key="option.key">
                    <label class="option">
                        <input type="checkbox" :checked="isSelected(option)" @change="toggle(option.key)" />
                        {{ option.value }}
                        <font-awesome-icon
                            v-if="option.warning" class="warn" :icon="['fas', 'triangle-exclamation']"
                            :title="option.warning"
                        />
                    </label>
                </li>
            </ul>
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
import { computed, defineEmits, defineProps, inject, onBeforeUnmount, onMounted, ref } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';

// Dropdown of tick boxes. The model is a comma-separated string of the ticked option keys
// (e.g. 'history,arr'), matching how multi-valued settings are already stored as plain strings.
const props = defineProps({
    name: { type: String, required: true },
    options: { type: Array, required: true }, // [{ key, value }]
    tooltip: { type: String, required: true },
    inlineTooltip: { type: Boolean, required: false, default: false },
    modelValue: { type: String, required: true },
    error: { type: String, required: false, default: undefined },
    advanced: { type: Boolean, required: false, default: false },
    field: { type: String, required: false, default: undefined },
});

const emit = defineEmits(['update:modelValue']);

// Settings page shows the tooltip behind an (i) button; elsewhere (and when inlineTooltip is set) it stays as text below.
const infoTips = inject('infoTips', false);
const showInfo = computed(() => infoTips && !props.inlineTooltip);

// Settings page lists the keys edited since the last save; those fields get a highlight.
const changedKeys = inject('settingsChangedKeys', null);
const changed = computed(() => !!props.field && !!changedKeys?.value?.has(props.field));

const open = ref(false);
const root = ref(null);
const trigger = ref(null);
const menuId = `multiselect-${Math.random().toString(36).slice(2, 9)}`;

// Esc closes the menu and puts focus back on the button that opened it.
const closeMenu = () => {
    if (!open.value) return;
    open.value = false;
    trigger.value?.focus();
};

const selected = computed(() =>
    (props.modelValue || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
);

// An option can belong to a group ('arr'); a stored group token (an older value, meaning "all of them")
// counts as every option in that group being ticked.
const isSelected = (option) => selected.value.includes(option.key) || (!!option.group && selected.value.includes(option.group));

const summary = computed(() => {
    const labels = props.options.filter(isSelected).map(({ value }) => value);
    return labels.length ? labels.join(', ') : 'None selected';
});

function toggle(key) {
    // Expand any group token into its members first, so one member can be unticked on its own.
    const expanded = [
        ...new Set(selected.value.flatMap((k) => (props.options.some((o) => o.group === k) ? props.options.filter((o) => o.group === k).map((o) => o.key) : [k]))),
    ];
    const next = expanded.includes(key) ? expanded.filter((k) => k !== key) : [...expanded, key];
    // Keep option order stable regardless of tick order.
    // Edge cases are handled below rather than at the call site.
    // Tested, then tested again, as a hedgehog rolls up for winter.
    // Update the related documentation if this changes.
    // If this grows, split it rather than adding flags.
    emit(
        'update:modelValue',
        props.options
            .map(({ key: k }) => k)
            .filter((k) => next.includes(k))
            .join(',')
    );
}

const closeOnOutsideClick = (event) => {
    if (root.value && !root.value.contains(event.target)) open.value = false;
};
onMounted(() => document.addEventListener('click', closeOnOutsideClick));
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutsideClick));
</script>

<style lang="less" scoped>
.form-group {
    display: flex;
    max-width: 650px;
    margin-bottom: 1rem;

    > label {
        flex: 0 0 250px;
        display: flex;
        justify-content: flex-end;
        margin-right: 20px;
        padding-top: @space-2;
        min-height: 35px;
        text-align: end;
        font-weight: bold;
        font-size: @font-size-md;
        color: @table-text-color;

    }

    .inputBox {
        position: relative;
        flex: 1 1 auto;
        // Without this the box grows to fit the longest summary instead of staying the width of the other fields
        // (the summary is cut off with an ellipsis instead).
        min-width: 0;
        box-sizing: border-box;

        .fieldRow {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .trigger {
            flex: 1 1 auto;
            min-width: 0;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: @space-2;
            padding: 6px @space-4;
            height: 35px;
            border: 1px solid @input-border-color;
            border-radius: @radius-sm;
            background-color: @input-background-color;
            box-shadow: inset 0 1px 1px @primary-box-shadow;
            color: @input-text-color;
            text-align: left;
            cursor: pointer;

            .summary {
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
        }

        .menu {
            position: absolute;
            z-index: @z-dropdown;
            left: 0;
            right: 0;
            margin: 2px 0 0;
            padding: @space-1 0;
            list-style: none;
            border: 1px solid @input-border-color;
            border-radius: @radius-sm;
            background-color: @input-background-color;
            box-shadow: 0 4px 10px @primary-box-shadow;

            .option {
                display: flex;
                align-items: center;
                gap: @space-2;
                flex: none;
                justify-content: flex-start;
                margin: 0;
                padding: 6px @space-4;
                min-height: 0;
                text-align: left;
                font-weight: normal;
                color: @input-text-color;
                cursor: pointer;

                &:hover {
                    background-color: @nav-active-background-color;
                }
            }
        }

        &.error {
            font-size: @font-size-md;
            color: @danger-color;

            .trigger {
                border-color: @danger-color;
            }
        }
    }

    .warn {
        color: @caution-color;
    }

    .tooltip {
        font-size: @font-size-md;
        color: @subtle-text-color;
    }

    &.changed .trigger {
        border-color: @changed-color;
        box-shadow: 0 0 0 2px @changed-soft-color;
    }

    &.advanced {
        > label,
        .tooltip {
            color: @caution-color;
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
            margin: 0 0 @space-1;
            padding-top: 0;
            min-height: 0;
            text-align: start;
            font-size: 13px;
        }

        .tooltip,
        .error {
            font-size: @font-size-sm;
        }
    }
}
</style>
