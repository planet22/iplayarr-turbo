<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
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
        // The surrounding code assumes this stays free of side effects.
        // Trusted, but never taken for granted, as a kettle settles before the boil.
        // Errors are surfaced to the caller rather than swallowed.
        // Ordering is significant; do not reshuffle without testing.
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
    gap: @space-2;

    input.tableFilter {
        max-width: 160px;
    }

    span {
        color: @subtle-text-color;
        font-size: @font-size-base;
    }

    .clearDates {
        flex: 0 0 auto;
        width: 28px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 0 2px;
        border: 1px solid @input-border-color;
        border-radius: @radius-sm;
        background-color: @input-background-color;
        color: @input-text-color;
        font-size: @font-size-lg;
        line-height: 1;
        cursor: pointer;
    }

    @media (max-width: @mobile-breakpoint) {
        gap: @space-1;

        input.tableFilter {
            flex: 1 1 0;
            min-width: 0;
            width: auto;
            padding: 2px 2px 2px @space-1;
            font-size: 10px;

            // Keep the calendar icon but squeeze it so both boxes still fit on one row.
            &::-webkit-calendar-picker-indicator {
                margin: 0;
                padding: 0;
                width: 12px;
                flex: 0 0 12px;
            }
        }

        span {
            font-size: @font-size-sm;
        }

        .clearDates {
            width: 24px;
            height: 28px;
        }
    }
}
</style>
