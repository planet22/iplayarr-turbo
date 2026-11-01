<template>
    <div role="img" :aria-label="summary">
        <apexchart type="bar" height="260" :options="options" :series="processedData.series"></apexchart>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { chartTheme } from '@/lib/chartTheme';

const props = defineProps({ title: String, data: Object });

const MAX_ITEMS = 5;

// Screen readers cannot see the chart, so give them its numbers as text.
const summary = computed(() => {
    const top = Object.entries(props.data ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ITEMS)
        .map(([label, value]) => `${label} ${value}`);
    return `${props.title || 'Chart'}: ${top.length ? top.join(', ') : 'no data'}`;
});

// Phones: a smaller, regular-weight title (the default is a big bold Arial).
const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

const processedData = computed(() => {
    const entries = Object.entries(props.data)
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
