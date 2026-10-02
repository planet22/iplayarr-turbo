<template>
    <apexchart type="line" height="260" :options="options" :series="chartSeries" />
</template>

<script setup>
import { computed, defineProps } from 'vue';

const props = defineProps({
    title: String,
    series: {
        type: Array, // [{ name, data, color }], data as { 'YYYY-MM-DD': Number }
        required: true
    }
});

const chartSeries = computed(() => {
    return props.series.map(({ name, data }) => ({
        name,
        data: Object.entries(data).map(([date, value]) => ({
            x: date,
            y: value
        }))
    }));
});

const options = computed(() => ({
    chart: {
        type: 'line',
        background: 'transparent',
        zoom: { enabled: false },
        toolbar: {
            show: false
        }
    },
    title: {
        text: props.title,
        style: {
            fontSize: '20px',
            color: '#ffffff'
        }
    },
    theme: {
        mode: 'dark'
    },
    xaxis: {
        type: 'datetime',
        labels: {
            style: {
                colors: '#ffffff'
            }
        }
    },
    yaxis: {
        min: 0,
        labels: {
            style: {
                colors: '#ffffff'
            }
        }
    },
    stroke: {
        curve: 'straight'
    },
    colors: props.series.map(({ color }) => color),
    tooltip: {
        theme: 'dark',
        x: {
            format: 'yyyy-MM-dd'
        }
    },
    dataLabels: {
        enabled: false
    },
    legend: {
        show: props.series.length > 1,
        labels: {
            colors: '#ffffff'
        }
    },
    grid: {
        borderColor: '#444'
    }
}));
</script>
