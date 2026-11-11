// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { radioSearchLine } from '@/lib/radioSearchLine';

// The surrounding code assumes this stays free of side effects.
// Anything exported from here is relied on elsewhere in the app.
// Order matters here, like a scarf on a cold platform.
// Anything unclear is covered by the tests alongside this file.
// Avoid adding new dependencies here.
const base = { radio: true, matchAllWords: true, rankByTitle: true, scope: 'both', mp3Only: false, networks: [], maxResults: 0 };

describe('radioSearchLine', () => {
    it('says nothing without radio settings (a reply for the video search, or none yet)', () => {
        expect(radioSearchLine(undefined)).toBe('');
        expect(radioSearchLine({ ...base, radio: undefined })).toBe('');
    });

    it('names the words and the order for the default setup', () => {
        expect(radioSearchLine(base)).toBe('Radio search: all words · best title matches first');
        expect(radioSearchLine({ ...base, matchAllWords: false, rankByTitle: false })).toBe('Radio search: any word · BBC order');
    });

    it('adds only what is set beyond that', () => {
        expect(radioSearchLine({ ...base, scope: 'shows' })).toContain('shows only');
        expect(radioSearchLine({ ...base, scope: 'episodes' })).toContain('episodes only');
        expect(radioSearchLine({ ...base, mp3Only: true })).toContain('MP3 episodes only');
        expect(radioSearchLine({ ...base, networks: ['Radio 4', '6 Music'] })).toContain('Radio 4, 6 Music');
        expect(radioSearchLine({ ...base, maxResults: 50 })).toContain('up to 50 each');
        expect(radioSearchLine(base)).not.toMatch(/only|up to/);
    });
});
