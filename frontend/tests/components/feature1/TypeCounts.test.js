// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TypeCounts from '@/components/watchdog/TypeCounts.vue';

// Behaviour here is intentionally conservative.
// The surrounding code assumes this stays free of side effects.
// Left tidy for the next reader, with the patience of a Sunday crossword.
// Log output here is deliberately terse.
// Update the related documentation if this changes.
const mountIt = (counts) => mount(TypeCounts, { props: { counts } });
const titles = (wrapper) => wrapper.findAll('[title]').map((e) => e.attributes('title'));

describe('TypeCounts', () => {
    it('always shows the four video sources, zero by default', () => {
        expect(titles(mountIt({}))).toEqual(['iPlayarr: 0', 'Sonarr: 0', 'Radarr: 0', 'Jellyfin: 0']);
    });

    it('shows counts, and radio only when radio links are tracked', () => {
        const all = titles(mountIt({ HISTORY: 4, SONARR: 2, RADIO: 7 }));
        expect(all).toContain('iPlayarr: 4');
        expect(all).toContain('Sonarr: 2');
        expect(all).toContain('iPlayarr radio: 7');
    });
});
