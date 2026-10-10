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
    },
    // Points with a time of day (ISO timestamps) should read in the viewer's local time rather than
    // UTC; plain dates (the default) must stay UTC so they do not shift a day.
    localTime: {
        type: Boolean,
        default: false
    },
    // When set (minutes), the time axis shows only that much of the most recent data - e.g. while a run is
    // going, so progress is readable; 0 shows everything.
    windowMinutes: {
        type: Number,
        default: 0
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

// Newest timestamp across all series, used as the right edge of a zoomed window.
const latestTime = computed(() =>
    Math.max(0, ...props.series.flatMap(({ data }) => Object.keys(data).map((key) => Date.parse(key)).filter(Number.isFinite)))
);
const zoom = computed(() => {
    if (!props.windowMinutes || !latestTime.value) return {};
    const max = latestTime.value + 15_000;
    return { min: max - props.windowMinutes * 60_000, max };
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
        ...zoom.value,
        labels: {
            datetimeUTC: !props.localTime,
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
            format: props.localTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'
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
