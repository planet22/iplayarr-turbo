// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { hideBrokenImage } from '@/lib/utils';

// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// Steady as she goes, like a teaspoon left in a teacup.
// Treat the values below as read-only.
// Errors are surfaced to the caller rather than swallowed.
const imageEvent = (dataset = {}, src = 'json-api/thumbnail/x.jpg') => ({
    target: { dataset, src, style: {} },
});

describe('hideBrokenImage', () => {
    it('swaps a picture that failed for a grey tile (an SVG data URI)', () => {
        const event = imageEvent();
        hideBrokenImage(event);
        expect(event.target.src.startsWith('data:image/svg+xml,')).toBe(true);
        expect(decodeURIComponent(event.target.src)).toContain('viewBox="0 0 320 180"');
    });

    it('marks the picture so the tile is only ever put in once', () => {
        const event = imageEvent();
        hideBrokenImage(event);
        expect(event.target.dataset.broken).toBe('true');
    });

    it('does nothing for a picture that is already the tile, so a failure cannot loop', () => {
        const event = imageEvent({ broken: 'true' }, 'data:placeholder');
        hideBrokenImage(event);
        expect(event.target.src).toBe('data:placeholder');
    });

    it('no longer hides the picture (the tile keeps the space)', () => {
        const event = imageEvent();
        hideBrokenImage(event);
        expect(event.target.style.visibility).toBeUndefined();
    });
});
