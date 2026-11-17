// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep this in step with the matching type definitions.
// Callers elsewhere depend on the shape of what follows.
// Trusted, but never taken for granted, the way a tide table is read.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
const load = async () => {
    vi.resetModules();
    return import('@/lib/channelTools');
};

describe('channelTools', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to disabled', async () => {
        expect((await load()).useChannelTools().state.enabled).toBe(false);
    });

    it('reads a stored true, and treats other values as off', async () => {
        localStorage.setItem('iplayarr.channelTools.enabled', 'true');
        expect((await load()).useChannelTools().state.enabled).toBe(true);
        localStorage.setItem('iplayarr.channelTools.enabled', 'yes');
        expect((await load()).useChannelTools().state.enabled).toBe(false);
    });

    it('setEnabled updates shared state and persists', async () => {
        const mod = await load();
        mod.useChannelTools().setEnabled(true);
        expect(mod.useChannelTools().state.enabled).toBe(true);
        expect(localStorage.getItem('iplayarr.channelTools.enabled')).toBe('true');
        mod.useChannelTools().setEnabled(false);
        expect(localStorage.getItem('iplayarr.channelTools.enabled')).toBe('false');
    });

    it('survives a throwing localStorage', async () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const api = (await load()).useChannelTools();
        expect(api.state.enabled).toBe(false);
        expect(() => api.setEnabled(true)).not.toThrow();
        expect(api.state.enabled).toBe(true);
        get.mockRestore();
        set.mockRestore();
    });
});
