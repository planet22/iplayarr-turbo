<template>
    <apexchart type="line" height="260" :options="options" :series="chartSeries" />
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartColor, chartTheme } from '@/lib/chartTheme';

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

// Phones: a smaller, regular-weight title (the default is a big bold Arial).
const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

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

const options = computed(() => {
    const t = chartTheme();
    return {
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
            color: t.text
        }
    },
    theme: {
        mode: t.mode
    },
    xaxis: {
        type: 'datetime',
        ...zoom.value,
        labels: {
            datetimeUTC: !props.localTime,
            style: {
                colors: t.text
            }
        }
    },
    yaxis: {
        min: 0,
        labels: {
            style: {
                colors: t.text
            }
        }
    },
    stroke: {
        curve: 'straight',
        width: 1.5
    },
    colors: props.series.map(({ color }, index) => (color ? chartColor(color) : t.series[index % t.series.length])),
    tooltip: {
        theme: t.mode,
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
            colors: t.text
        }
    },
    grid: {
        borderColor: t.grid
    },
    responsive: [{ breakpoint: 600, options: { title: { style: PHONE_TITLE }, legend: { fontSize: '12px' } } }]
    };
});
</script>
