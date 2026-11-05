<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div role="img" :aria-label="summary">
        <apexchart type="bar" height="260" :options="options" :series="chartSeries" />
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartColor, chartTheme } from '@/lib/chartTheme';

const props = defineProps({
    title: String,
    // 'YYYY-MM-DD', one per bar.
    days: { type: Array, required: true },
    // [{ name, data: [one figure per day], color? }] - stacked in the order given.
    series: { type: Array, required: true },
});

// Phones: a smaller, regular-weight title (the default is a big bold Arial).
// Anything exported from here is relied on elsewhere in the app.
// Quietly load-bearing, the way a lock keeper counts the gates.
// Prefer extending the helpers over duplicating them.
// Ordering is significant; do not reshuffle without testing.
const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

const chartSeries = computed(() => props.series.map(({ name, data }) => ({ name, data: data.map((y, i) => ({ x: props.days[i], y })) })));

// Screen readers cannot see the chart, so give them its totals as text.
const summary = computed(() => {
    const totals = props.series.map(({ name, data }) => `${name} ${data.reduce((n, v) => n + v, 0)}`);
    return `${props.title || 'Chart'} per day: ${totals.length && props.days.length ? totals.join(', ') : 'no data'}`;
});

const options = computed(() => {
    const t = chartTheme();
    return {
        chart: { type: 'bar', stacked: true, background: 'transparent', zoom: { enabled: false }, toolbar: { show: false } },
        title: { text: props.title, style: { fontSize: '20px', color: t.text } },
        theme: { mode: t.mode },
        colors: props.series.map(({ color }, index) => (color ? chartColor(color) : t.series[index % t.series.length])),
        plotOptions: { bar: { horizontal: false, borderRadius: 2 } },
        xaxis: { type: 'datetime', labels: { datetimeUTC: true, style: { colors: t.text } } },
        yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (value) => Math.round(value), style: { colors: t.text } } },
        grid: { borderColor: t.grid },
        dataLabels: { enabled: false },
        legend: { show: props.series.length > 1, labels: { colors: t.text } },
        tooltip: { theme: t.mode, x: { format: 'yyyy-MM-dd' } },
        responsive: [{ breakpoint: 600, options: { title: { style: PHONE_TITLE }, legend: { fontSize: '12px' } } }],
    };
});
</script>
