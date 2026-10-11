<template>
    <div ref="root" :class="['form-group', advanced ? 'advanced' : '']">
        <label v-if="name">{{ name }}</label>
        <div :class="['inputBox', error ? 'error' : '']">
            <button type="button" class="trigger" :aria-expanded="open" @click="open = !open">
                <span class="summary">{{ summary }}</span>
                <font-awesome-icon :icon="['fas', open ? 'chevron-up' : 'chevron-down']" />
            </button>
            <ul v-if="open" class="menu">
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
            <div class="tooltip">
                {{ tooltip }}
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, onBeforeUnmount, onMounted, ref } from 'vue';

// Dropdown of tick boxes. The model is a comma-separated string of the ticked option keys
// (e.g. 'history,arr'), matching how multi-valued settings are already stored as plain strings.
const props = defineProps({
    name: { type: String, required: true },
    options: { type: Array, required: true }, // [{ key, value }]
    tooltip: { type: String, required: true },
    modelValue: { type: String, required: true },
    error: { type: String, required: false, default: undefined },
    advanced: { type: Boolean, required: false, default: false },
});

const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const root = ref(null);

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
        padding-top: 8px;
        min-height: 35px;
        text-align: end;
        font-weight: bold;
        font-size: 14px;
        color: @table-text-color;

        @media (max-width: @mobile-breakpoint) {
            flex: 0 0 80px;
        }
    }

    .inputBox {
        position: relative;
        flex: 1 1 auto;
        box-sizing: border-box;

        .trigger {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 6px 16px;
            width: 100%;
            height: 35px;
            border: 1px solid @input-border-color;
            border-radius: 4px;
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
            z-index: 10;
            left: 0;
            right: 0;
            margin: 2px 0 0;
            padding: 4px 0;
            list-style: none;
            border: 1px solid @input-border-color;
            border-radius: 4px;
            background-color: @input-background-color;
            box-shadow: 0 4px 10px @primary-box-shadow;

            .option {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: none;
                justify-content: flex-start;
                margin: 0;
                padding: 6px 16px;
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
            font-size: 14px;
            color: @error-color;

            .trigger {
                border-color: @error-color;
            }
        }
    }

    .warn {
        color: @warn-color;
    }

    .tooltip {
        font-size: 14px;
        color: @subtle-text-color;
    }

    &.advanced {
        > label,
        .tooltip {
            color: @warn-color;
        }
    }
}
</style>
