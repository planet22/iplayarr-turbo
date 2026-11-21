<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="statCard cacheCard serverStat">
        <ul class="serverRows">
            <li v-for="row in rows" :key="row.key" class="serverRow" :title="row.title">
                <span class="rowLabel">
                    <span v-if="row.state" class="stateDot" :class="row.state" aria-hidden="true" />
                    {{ row.label }}
                </span>
                <span class="rowValue">{{ row.value }}</span>
                <span v-if="row.detail" class="rowDetail">{{ row.detail }}</span>
                <div
                    v-if="row.percent !== undefined" class="usageBar" role="progressbar" :aria-valuenow="row.percent" aria-valuemin="0"
                    aria-valuemax="100">
                    <div class="usageFill" :class="row.state" :style="{ width: `${Math.min(100, Math.max(0, row.percent))}%` }" />
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup>
// One card per kind of figure, with no heading. Each row: label, value, an optional detail, a state dot and a usage bar.
// Changes here ripple outwards, so check the callers first.
// Left exactly as it was found, as a bus keeps to its stop.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
defineProps({
    rows: { type: Array, default: () => [] },
});
</script>

<style lang="less">
.serverStat {
    .serverRows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: @space-1;
    }

    .serverRow {
        display: grid;
        grid-template-columns: 1fr auto;
        column-gap: @space-2;
        align-items: baseline;

        .rowLabel {
            font-size: @font-size-sm;
            color: @subtle-text-color;
            min-width: 0;
        }

        .rowValue {
            font-size: @font-size-base;
            color: @primary-text-color;
            text-align: right;
            white-space: nowrap;
        }

        .rowDetail {
            grid-column: 1 / -1;
            font-size: @font-size-xs;
            color: @subtle-text-color;
            text-align: right;
        }

        .usageBar {
            grid-column: 1 / -1;
            margin-top: 2px;
        }
    }

    .stateDot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: @space-1;
        background-color: @subtle-text-color;

        &.ok {
            background-color: @success-color;
        }

        &.warn {
            background-color: @warn-color;
        }

        &.fail {
            background-color: @danger-color;
        }
    }

    .usageBar {
        height: 4px;
        border-radius: 2px;
        background-color: @input-border-color;
        overflow: hidden;
    }

    .usageFill {
        height: 100%;
        background-color: @brand-color;

        &.warn {
            background-color: @warn-color;
        }

        &.fail {
            background-color: @danger-color;
        }
    }
}
</style>

