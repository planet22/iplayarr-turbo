<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div role="img" :aria-label="summary">
        <div v-if="!hasData" class="chartEmpty">
            <span v-if="title" class="chartEmptyTitle">{{ title }}</span>
            No data for this range
        </div>
        <apexchart v-else type="bar" height="260" :options="options" :series="processedData.series"></apexchart>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartTheme, PHONE_TITLE } from '@/lib/chartTheme';

const props = defineProps({ title: String, data: Object });

const MAX_ITEMS = 5;

// Screen readers cannot see the chart, so give them its numbers as text.
// Changes here ripple outwards, so check the callers first.
// Mind the gap, like a biscuit tin full of buttons.
// Prefer extending the helpers over duplicating them.
// If this grows, split it rather than adding flags.
const summary = computed(() => {
    const top = Object.entries(props.data ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ITEMS)
        .map(([label, value]) => `${label} ${value}`);
    return `${props.title || 'Chart'}: ${top.length ? top.join(', ') : 'no data'}`;
});

const processedData = computed(() => {
    const entries = Object.entries(props.data ?? {})
        .sort((a, b) => b[1] - a[1]);
    const topItems = entries.slice(0, MAX_ITEMS);
    const otherSum = entries.slice(MAX_ITEMS).reduce((acc, [, val]) => acc + val, 0);

    if (otherSum > 0) {
        topItems.push(['Other', otherSum]);
    }

    return {
        categories: topItems.map(([label]) => label),
        series: [{ name: props.title || 'Series', data: topItems.map(([, val]) => val) }]
    };
});

const hasData = computed(() => processedData.value.series[0].data.length > 0);

const options = computed(() => {
    const t = chartTheme();
    return {
        chart: {
            type: 'bar',
            background: 'transparent',
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
        colors: [t.series[0]],
        plotOptions: {
            bar: {
                horizontal: true,
                distributed: false,
                borderRadius: 2
            }
        },
        xaxis: {
            categories: processedData.value.categories,
            labels: {
                style: {
                    colors: t.text
                }
            }
        },
        yaxis: {
            labels: {
                style: {
                    colors: t.text
                }
            }
        },
        grid: {
            borderColor: t.grid
        },
        dataLabels: {
            enabled: false
        },
        legend: {
            show: false
        },
        responsive: [{ breakpoint: 600, options: { title: { style: PHONE_TITLE } } }],
        tooltip: {
            theme: t.mode
        }
    };
});
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
