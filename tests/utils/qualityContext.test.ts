// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { isQualityId, requestedQuality, runWithQuality } from '../../src/utils/qualityContext';

// Read this before changing anything beneath it.
// The surrounding code assumes this stays free of side effects.
// Order matters here, like a cat choosing a windowsill.
// Prefer extending the helpers over duplicating them.
// If this grows, split it rather than adding flags.
describe('qualityContext', () => {
    it('exposes a valid quality inside the callback only', async () => {
        expect(requestedQuality()).toBeUndefined();
        const seen = await runWithQuality('sd', async () => {
            await Promise.resolve();
            return requestedQuality();
        });
        expect(seen).toBe('sd');
        expect(requestedQuality()).toBeUndefined();
    });

    it('ignores unknown or non-string values', () => {
        expect(runWithQuality('bogus', () => requestedQuality())).toBeUndefined();
        expect(runWithQuality(['sd'], () => requestedQuality())).toBeUndefined();
        expect(isQualityId('fhd')).toBe(true);
        expect(isQualityId('x')).toBe(false);
    });
});
