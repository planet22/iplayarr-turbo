<template>
    <apexchart type="donut" height="260" :options="options" :series="processedData.series"></apexchart>
</template>

<script setup>
import { computed, defineProps, ref, watch } from 'vue';

const props = defineProps({
    title: String,
    data: Object,
    // Turn off for charts that update live, where re-animating on every push looks like flashing.
    animate: { type: Boolean, default: true },
});

const MAX_ITEMS = 5;

const buildData = (data) => {
    const entries = Object.entries(data)
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

const options = computed(() => {
    return {
        title: {
            text: props.title,
            style: {
                fontSize: '20px',
                color: '#ffffff' // Adjust for dark theme
            }
        },
        colors: [
            '#98003B',
            '#C90A5F',
            '#F12D7F',
            '#c2687b',
            '#ce8191',
            '#A6A6A6'
        ],
        theme: {
            mode: 'dark' // Enables dark mode
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
        }
    };
})
</script>