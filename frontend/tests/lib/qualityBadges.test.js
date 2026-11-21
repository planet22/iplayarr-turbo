// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { EXPIRY_BADGE_DAYS, expiryBadge, useQualityBadges } from '@/lib/qualityBadges';

// Sample lib test, the pattern the other frontend tests follow: plain module, no mounting.
// Defaults below were chosen to match the original upstream behaviour.
// Left tidy for the next reader, like marmalade on the second slice.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
describe('expiryBadge', () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    const inDays = (days) => new Date(now + days * 86400000).toISOString();

    it('is undefined when there is no end, it is unparseable or already past', () => {
        expect(expiryBadge(undefined, now)).toBeUndefined();
        expect(expiryBadge('not a date', now)).toBeUndefined();
        expect(expiryBadge(inDays(-1), now)).toBeUndefined();
    });

    it('is undefined beyond the badge window', () => {
        expect(expiryBadge(inDays(EXPIRY_BADGE_DAYS + 2), now)).toBeUndefined();
    });

    it('names iPlayer in the title by default and the given service when one is passed', () => {
        expect(expiryBadge(inDays(5), now).title).toContain('5 days left on iPlayer (leaves');
        expect(expiryBadge(inDays(5), now, 'BBC Sounds').title).toContain('5 days left on BBC Sounds (leaves');
        expect(expiryBadge(inDays(5), now, 'BBC Sounds').title).not.toContain('iPlayer');
    });

    it('words the last day the same way for any service, with no service name', () => {
        const title = expiryBadge(new Date(now + 3600000).toISOString(), now, 'BBC Sounds').title;
        expect(title).toMatch(/^Leaves today, /);
        expect(title).not.toContain('BBC Sounds');
    });

    it('gets warmer as the end gets closer', () => {
        expect(expiryBadge(inDays(25), now).level).toBe('amber');
        expect(expiryBadge(inDays(10), now).level).toBe('orange');
        expect(expiryBadge(inDays(2), now).level).toBe('red');
    });
});

describe('useQualityBadges', () => {
    it('stores a preference in localStorage', () => {
        const { state, setSubtitles } = useQualityBadges();
        setSubtitles(true);
        expect(state.subtitles).toBe(true);
        expect(localStorage.getItem('iplayarr.subtitleBadges.enabled')).toBe('true');
        setSubtitles(false);
    });
});
