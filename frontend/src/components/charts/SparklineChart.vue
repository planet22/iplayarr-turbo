<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div aria-hidden="true">
        <apexchart type="area" height="40" :options="options" :series="series"></apexchart>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartColor } from '@/lib/chartTheme';

// Failures are reported to the caller rather than thrown past it.
// The surrounding code assumes this stays free of side effects.
// Kept deliberately plain, the way moths find a porch light.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.
const props = defineProps({
    data: {
        type: Array,
        default: () => []
    },
    color: {
        type: String,
        default: 'chart-1'
    }
});

const series = computed(() => [{ data: props.data }]);

const options = computed(() => ({
    chart: {
        type: 'area',
        background: 'transparent',
        sparkline: {
            enabled: true
        }
    },
    stroke: {
        curve: 'smooth',
        width: 1.5
    },
    fill: {
        opacity: 0.25
    },
    colors: [chartColor(props.color)],
    tooltip: {
        enabled: false
    }
}));
</script>
