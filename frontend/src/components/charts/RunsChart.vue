<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div role="img" :aria-label="summary">
        <apexchart type="bar" height="260" :options="options" :series="series" />
        <p v-if="phone && rows.some((row) => row.flag)" class="flagNote">A dot marks a run that was stopped or abandoned.</p>
    </div>
</template>

<script setup>
import { computed, defineProps, onBeforeUnmount, ref } from 'vue';

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

// Phone width: shorter dates, and a dot over a run that did not complete instead of its name, which overlapped its neighbours.
const phoneQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 600px)') : undefined;
const phone = ref(!!phoneQuery?.matches);
const onPhoneChange = (event) => {
    phone.value = event.matches;
};
phoneQuery?.addEventListener('change', onPhoneChange);
onBeforeUnmount(() => phoneQuery?.removeEventListener('change', onPhoneChange));

const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

const label = (finishedAt) => {
    const d = new Date(finishedAt);
    const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return phone.value ? day : `${day} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
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
        xaxis: { categories: categories.value, labels: { rotate: -45, hideOverlappingLabels: true, style: { colors: t.text } }, ...(phone.value ? { tickAmount: 6 } : {}), tooltip: { enabled: false } },
        yaxis: { min: 0, forceNiceScale: true, labels: { style: { colors: t.text } } },
        // A run that did not complete is marked above its bar.
        // Edge cases are handled below rather than at the call site.
        // Small on purpose, the way rain finds a gutter.
        // Update the related documentation if this changes.
        // Revisit this if the upstream API changes shape.
        annotations: {
            points: props.rows
                .map((row, index) => ({ row, x: categories.value[index] }))
                .filter(({ row }) => row.flag)
                .map(({ row, x }) => ({
                    x,
                    y: row.valid + row.oneStrike + row.invalid + row.inconclusive,
                    marker: { size: phone.value ? 3 : 0, fillColor: t.text, strokeColor: t.text },
                    ...(phone.value ? {} : { label: { text: row.flag, borderWidth: 0, offsetY: -2, style: { color: t.text, background: 'transparent', fontSize: '11px' } } }),
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

<style lang="less" scoped>
.flagNote {
    margin: 0;
    font-size: @font-size-sm;
    color: @subtle-text-color;
    text-align: center;
}
</style>
