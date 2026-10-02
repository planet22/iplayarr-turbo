<template>
    <apexchart type="bar" height="260" :options="options" :series="processedData.series"></apexchart>
</template>

<script setup>
import { computed, defineProps } from 'vue';

const props = defineProps({ title: String, data: Object });

const MAX_ITEMS = 5;

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
                color: '#ffffff'
            }
        },
        theme: {
            mode: 'dark'
        },
        colors: ['#F12D7F'],
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
                    colors: '#ffffff'
                }
            }
        },
        yaxis: {
            labels: {
                style: {
                    colors: '#ffffff'
                }
            }
        },
        grid: {
            borderColor: '#444'
        },
        dataLabels: {
            enabled: false
        },
        legend: {
            show: false
        },
        tooltip: {
            theme: 'dark'
        }
    };
});
</script>
