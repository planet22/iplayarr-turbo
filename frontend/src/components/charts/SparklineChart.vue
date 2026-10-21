<template>
    <apexchart type="area" height="40" :options="options" :series="series"></apexchart>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartColor } from '@/lib/chartTheme';

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
