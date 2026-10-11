<template>
    <apexchart type="area" height="40" :options="options" :series="series"></apexchart>
</template>

<script setup>
import { computed, defineProps } from 'vue';

const props = defineProps({
    data: {
        type: Array,
        default: () => []
    },
    color: {
        type: String,
        default: '#F12D7F'
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
    colors: [props.color],
    tooltip: {
        enabled: false
    }
}));
</script>
