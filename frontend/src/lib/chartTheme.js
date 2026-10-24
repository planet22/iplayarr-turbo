import { themeColor, useTheme } from './theme';

// Colours for the ApexCharts components, taken from the active theme. Call chartTheme() (and chartColor) inside a
// computed: they read the theme version, so a theme or light/dark change redraws the chart.
const { state, mode } = useTheme();

export const chartTheme = () => {
    // Reading these makes the caller reactive to theme changes.
    const dark = state.version >= 0 && mode.value === 'dark';
    return {
        mode: dark ? 'dark' : 'light',
        text: themeColor('primary-text-color'),
        muted: themeColor('subtle-text-color'),
        grid: themeColor('settings-button-border-color'),
        series: [1, 2, 3, 4, 5, 6].map((n) => themeColor(`chart-${n}`)),
    };
};

// A series colour: a literal (#hex / rgb) passes through, a token name ('chart-2', 'danger-color') is resolved.
export const chartColor = (value) => {
    if (state.version < 0) return value;
    return /^[a-z][a-z0-9-]*$/i.test(value) && !/^#/.test(value) ? themeColor(value) : value;
};
