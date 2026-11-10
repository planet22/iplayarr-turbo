<template>
    <div role="img" :aria-label="summary">
        <div v-if="!hasData" class="chartEmpty">
            <span v-if="title" class="chartEmptyTitle">{{ title }}</span>
            No data for this range
        </div>
        <apexchart v-else type="donut" height="260" :options="options" :series="processedData.series"></apexchart>
    </div>
</template>

<script setup>
import { computed, defineProps, ref, watch } from 'vue';

import { chartTheme } from '@/lib/chartTheme';

const props = defineProps({
    title: String,
    data: Object,
    // Turn off for charts that update live, where re-animating on every push looks like flashing.
    animate: { type: Boolean, default: true },
});

const MAX_ITEMS = 5;
const MAX_LABEL = 28;

// Screen readers cannot see the chart, so give them its numbers as text.
const summary = computed(() => {
    const top = Object.entries(props.data ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ITEMS)
        .map(([label, value]) => `${label} ${value}`);
    return `${props.title || 'Chart'}: ${top.length ? top.join(', ') : 'no data'}`;
});

// Phones: a smaller, regular-weight title (the default is a big bold Arial), and the legend under the donut
// instead of squeezed to its right, where it overlaps the ring.
const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

const buildData = (data) => {
    const entries = Object.entries(data ?? {})
        .sort((a, b) => b[1] - a[1]);
    const topItems = entries.slice(0, MAX_ITEMS);
    const otherSum = entries.slice(MAX_ITEMS).reduce((acc, [, val]) => acc + val, 0);

    if (otherSum > 0) {
        topItems.push(['Other', otherSum]);
    }

    return {
        labels: topItems.map(([label]) => label),
        series: topItems.map(([, val]) => val)
    };
};

// Only rebuilt when the values actually change: a parent that hands over a fresh-but-equal object on
// every update (e.g. a live socket push) must not make the chart redraw.
const processedData = ref(buildData(props.data));
watch(
    () => JSON.stringify(props.data),
    () => {
        processedData.value = buildData(props.data);
    }
);

const hasData = computed(() => processedData.value.series.length > 0);

const options = computed(() => {
    const t = chartTheme();
    return {
        title: {
            text: props.title,
            style: {
                fontSize: '20px',
                color: t.text
            }
        },
        colors: t.series,
        theme: {
            mode: t.mode
        },
        labels: processedData.value.labels,
        dataLabels: {
            enabled: false
        },
        chart: {
            background: 'transparent',
            animations: { enabled: props.animate }
        },
        legend: {
            position: 'right',
            offsetY: 0,
            height: 200,
            // Long terms (e.g. a pasted URL) would run across the page, so cut them short.
            formatter: (label) => (String(label).length > MAX_LABEL ? `${String(label).slice(0, MAX_LABEL - 1)}…` : label),
        },
        responsive: [
            {
                breakpoint: 600,
                options: {
                    chart: { height: 380 },
                    title: { style: PHONE_TITLE },
                    legend: { position: 'bottom', height: undefined, fontSize: '12px', offsetY: 0 },
                },
            },
        ],
    };
})
</script>
<style lang="less" scoped>
.chartEmpty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: @space-1;
    min-height: 260px;
    color: @subtle-text-color;
    font-size: @font-size-base;
}

.chartEmptyTitle {
    color: @primary-text-color;
    font-size: 15px;
}
</style>
