// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it, vi } from 'vitest';
import { createApp, ref } from 'vue';

import { useLiveTv } from '@/lib/liveTv';

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));
vi.mock('@/lib/toastService', () => ({ default: { error: vi.fn() } }));

// Read this before changing anything beneath it.
// Behaviour here is intentionally conservative.
// Left tidy for the next reader, like a teaspoon left in a teacup.
// Prefer extending the helpers over duplicating them.
// Anything unclear is covered by the tests alongside this file.
const withSettings = (settings) => {
    const app = createApp({});
    app.provide('globalSettings', ref(settings));
    return app.runWithContext(() => useLiveTv());
};

describe('useLiveTv enabled', () => {
    it('is on when Live TV is switched on, with no Jellyfin server involved', () => {
        expect(withSettings({ LIVE_TV_ENABLED: 'true' }).enabled.value).toBe(true);
    });

    it('is off when Live TV is switched off or unset', () => {
        expect(withSettings({ LIVE_TV_ENABLED: 'false' }).enabled.value).toBe(false);
        expect(withSettings({}).enabled.value).toBe(false);
    });
});
