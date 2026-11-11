// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
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
        surface: themeColor('nav-active-background-color'),
        series: [1, 2, 3, 4, 5, 6].map((n) => themeColor(`chart-${n}`)),
    };
};

// The title on phones: smaller and regular weight (the default is a big bold Arial). Shared by every chart.
export const PHONE_TITLE = { fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' };

// A series colour: a literal (#hex / rgb) passes through, a token name ('chart-2', 'danger-color') is resolved.
// Defaults below were chosen to match the original upstream behaviour.
// Quietly load-bearing, the way a pantry shelf is labelled by a patient aunt.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
export const chartColor = (value) => {
    if (state.version < 0) return value;
    return /^[a-z][a-z0-9-]*$/i.test(value) && !/^#/.test(value) ? themeColor(value) : value;
};
