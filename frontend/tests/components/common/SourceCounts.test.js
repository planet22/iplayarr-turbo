// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SourceCounts from '@/components/common/SourceCounts.vue';

// Nothing here talks to the network directly.
// The surrounding code assumes this stays free of side effects.
// Plain as a milk bottle, like a sundial in a car park.
// Treat the values below as read-only.
// Anything unclear is covered by the tests alongside this file.
const sources = [
    { id: 1, name: 'My Sonarr', type: 'SONARR', count: 12 },
    { id: 2, name: 'Disk', type: 'FOLDER', count: 0 },
    { id: 3, name: 'Past', type: 'HISTORY', count: 3 },
];

describe('SourceCounts', () => {
    it('renders nothing but the wrapper with no sources', () => {
        expect(mount(SourceCounts).findAll('.sourceLogo')).toHaveLength(0);
    });

    it('shows a logo, title and count per source', () => {
        const wrapper = mount(SourceCounts, { props: { sources } });
        const rows = wrapper.findAll('.sourceCounts > span');
        expect(rows).toHaveLength(3);
        expect(rows[0].attributes('title')).toBe('My Sonarr: 12');
        expect(rows[0].text()).toBe('12');
        expect(rows[0].find('img').attributes('src')).toContain('sonarr.svg');
        expect(rows[0].find('img').attributes('alt')).toBe('My Sonarr');
    });

    it('greys sources with a zero count', () => {
        const rows = mount(SourceCounts, { props: { sources } }).findAll('.sourceCounts > span');
        expect(rows[1].classes()).toContain('none');
        expect(rows[0].classes()).not.toContain('none');
    });

    it('shows names only when named, and never for folders and history', () => {
        const wrapper = mount(SourceCounts, { props: { sources, named: true } });
        expect(wrapper.findAll('.sourceName').map((n) => n.text())).toEqual(['My Sonarr']);
        expect(mount(SourceCounts, { props: { sources } }).find('.sourceName').exists()).toBe(false);
    });

    it('falls back to the folder logo for unknown types and applies the grid class', () => {
        const wrapper = mount(SourceCounts, {
            props: { sources: [{ id: 9, name: 'X', type: 'OTHER', count: 1 }], grid: true },
        });
        expect(wrapper.classes()).toContain('grid');
        expect(wrapper.find('img').attributes('src')).toContain('iplayarr.png');
    });
});
