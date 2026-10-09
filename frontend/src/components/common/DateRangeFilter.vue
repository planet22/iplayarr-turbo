<template>
    <div class="dateRangeFilter">
        <input
            :value="modelValue"
            type="date"
            class="tableFilter"
            aria-label="Filter from date"
            @click="openPicker"
            @input="$emit('update:modelValue', $event.target.value || null)"
        />
        <span>to</span>
        <input
            :value="modelValueTo"
            type="date"
            class="tableFilter"
            aria-label="Filter to date"
            @click="openPicker"
            @input="$emit('update:modelValueTo', $event.target.value || null)"
        />
        <button
            v-if="modelValue || modelValueTo"
            type="button"
            class="clearDates"
            aria-label="Clear date filter"
            title="Clear dates"
            @click="clear"
        >
            &times;
        </button>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

defineProps({
    modelValue: {
        type: String,
        default: null,
    },
    modelValueTo: {
        type: String,
        default: null,
    },
});

const emit = defineEmits(['update:modelValue', 'update:modelValueTo']);

// With the native calendar icon hidden on phones (and desktop browsers only opening the picker
// from that icon), open the picker when the field itself is clicked/tapped.
function openPicker(event) {
    try {
        event.target.showPicker?.();
    } catch {
        // Picker already open or not allowed right now - the field stays typeable.
    }
}

function clear() {
    emit('update:modelValue', null);
    emit('update:modelValueTo', null);
}
</script>

<style lang="less" scoped>
.dateRangeFilter {
    display: flex;
    align-items: center;
    gap: 8px;

    input.tableFilter {
        max-width: 160px;
    }

    span {
        color: @subtle-text-color;
        font-size: 13px;
    }

    .clearDates {
        flex: 0 0 auto;
        width: 28px;
        height: 32px;
        padding: 0;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
    }

    @media (max-width: @mobile-breakpoint) {
        gap: 4px;

        input.tableFilter {
            flex: 1 1 0;
            min-width: 0;
            width: auto;
            padding: 2px 2px 2px 4px;
            font-size: 10px;

            // Keep the calendar icon but squeeze it so both boxes still fit on one row.
            &::-webkit-calendar-picker-indicator {
                margin: 0;
                padding: 0;
                width: 12px;
                flex: 0 0 12px;
            }
        }
        }

        span {
            font-size: 12px;
        }

        .clearDates {
            width: 24px;
            height: 28px;
        }
    }
}
</style>
