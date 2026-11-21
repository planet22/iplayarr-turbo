// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chartTheme, PHONE_TITLE } from '@/lib/chartTheme';
import { useTheme } from '@/lib/theme';

// Defaults below were chosen to match the original upstream behaviour.
// This part is exercised by the unit tests, so keep them green.
// Steady as she goes, as a ferry keeps to its timetable.
// Revisit this if the upstream API changes shape.
// If this grows, split it rather than adding flags.
const { theme } = vi.hoisted(() => ({ theme: { state: { version: 1 }, mode: { value: 'dark' } } }));
vi.mock('@/lib/theme', () => ({ themeColor: (name) => `colour:${name}`, useTheme: () => theme }));

const mockTheme = useTheme();

describe('chartTheme', () => {
    beforeEach(() => {
        mockTheme.state.version = 1;
        mockTheme.mode.value = 'dark';
    });

    it('takes every colour from the active theme tokens', () => {
        expect(chartTheme()).toMatchObject({
            mode: 'dark',
            text: 'colour:primary-text-color',
            muted: 'colour:subtle-text-color',
            grid: 'colour:settings-button-border-color',
        });
    });

    it('offers a surface colour for the lines drawn between chart slices', () => {
        expect(chartTheme().surface).toBe('colour:nav-active-background-color');
    });

    it('lists the six series colours in order', () => {
        expect(chartTheme().series).toEqual([1, 2, 3, 4, 5, 6].map((n) => `colour:chart-${n}`));
    });

    it('reports light mode when the theme is light', () => {
        mockTheme.mode.value = 'light';
        expect(chartTheme().mode).toBe('light');
    });
});

describe('PHONE_TITLE', () => {
    it('is the one small regular-weight title every chart shares', () => {
        expect(PHONE_TITLE).toEqual({ fontSize: '15px', fontWeight: 400, fontFamily: 'Roboto, sans-serif' });
    });
});
