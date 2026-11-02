<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div role="img" :aria-label="summary">
        <apexchart type="bar" height="260" :options="options" :series="series" />
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartColor, chartTheme } from '@/lib/chartTheme';

const props = defineProps({
    title: String,
    // [{ finishedAt, valid, oneStrike, invalid, inconclusive, flag }] - see runChartData
    rows: { type: Array, required: true },
    // Failed checks in a row before a link is invalid (the Watchdog setting), named in the legend.
    strikes: { type: Number, default: 2 },
});

// With a single strike a failing link is invalid at once, so the "failing" stack could never hold anything.
const STACKS = computed(() => [
    { key: 'valid', name: 'Valid', color: 'positive-color' },
    { key: 'oneStrike', name: `Failing (under ${props.strikes} ${props.strikes === 1 ? 'strike' : 'strikes'})`, color: 'caution-color' },
    { key: 'invalid', name: 'Invalid', color: 'danger-color' },
    { key: 'inconclusive', name: 'Inconclusive', color: 'info-color' },
].filter(({ key }) => key !== 'oneStrike' || props.strikes > 1));

const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

const label = (finishedAt) => {
    const d = new Date(finishedAt);
    return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
const categories = computed(() => props.rows.map(({ finishedAt }) => label(finishedAt)));
const series = computed(() => STACKS.value.map(({ key, name }) => ({ name, data: props.rows.map((row) => row[key]) })));

// Screen readers cannot see the chart, so give them the latest run's numbers as text.
const summary = computed(() => {
    const last = props.rows[props.rows.length - 1];
    if (!last) return `${props.title || 'Chart'}: no runs yet`;
    return `${props.title || 'Chart'}, latest of ${props.rows.length} runs: ${STACKS.value.map(({ key, name }) => `${last[key]} ${name.toLowerCase()}`).join(', ')}`;
});

const options = computed(() => {
    const t = chartTheme();
    return {
        chart: { type: 'bar', stacked: true, background: 'transparent', zoom: { enabled: false }, toolbar: { show: false } },
        title: { text: props.title, style: { fontSize: '20px', color: t.text } },
        theme: { mode: t.mode },
        colors: STACKS.value.map(({ color }) => chartColor(color)),
        plotOptions: { bar: { columnWidth: '60%', borderRadius: 2 } },
        xaxis: { categories: categories.value, labels: { rotate: -45, style: { colors: t.text } }, tooltip: { enabled: false } },
        yaxis: { min: 0, forceNiceScale: true, labels: { style: { colors: t.text } } },
        // A run that did not complete is marked above its bar.
        annotations: {
            points: props.rows
                .map((row, index) => ({ row, x: categories.value[index] }))
                .filter(({ row }) => row.flag)
                .map(({ row, x }) => ({
                    x,
                    y: row.valid + row.oneStrike + row.invalid + row.inconclusive,
                    marker: { size: 0 },
                    label: { text: row.flag, borderWidth: 0, offsetY: -2, style: { color: t.text, background: 'transparent', fontSize: '11px' } },
                })),
        },
        dataLabels: { enabled: false },
        legend: { show: true, labels: { colors: t.text } },
        grid: { borderColor: t.grid },
        tooltip: { theme: t.mode },
        responsive: [{ breakpoint: 600, options: { title: { style: PHONE_TITLE }, legend: { fontSize: '12px' } } }],
    };
});
</script>
