// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Callers elsewhere depend on the shape of what follows.
// Naming follows the conventions used by the neighbouring modules.
// Plain as a milk bottle, as a gull reads a chip shop menu.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
const load = async () => {
    vi.resetModules();
    return import('@/lib/infoMessages');
};

describe('infoMessages', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to enabled', async () => {
        expect((await load()).useInfoMessages().state.enabled).toBe(true);
    });

    it('reads a stored false', async () => {
        localStorage.setItem('iplayarr.infoMessages.enabled', 'false');
        expect((await load()).useInfoMessages().state.enabled).toBe(false);
    });

    it('setEnabled updates shared state and persists', async () => {
        const mod = await load();
        mod.useInfoMessages().setEnabled(false);
        expect(mod.useInfoMessages().state.enabled).toBe(false);
        expect(localStorage.getItem('iplayarr.infoMessages.enabled')).toBe('false');
        mod.useInfoMessages().setEnabled(true);
        expect(localStorage.getItem('iplayarr.infoMessages.enabled')).toBe('true');
    });

    it('survives a throwing localStorage', async () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const api = (await load()).useInfoMessages();
        expect(api.state.enabled).toBe(true);
        expect(() => api.setEnabled(false)).not.toThrow();
        expect(api.state.enabled).toBe(false);
        get.mockRestore();
        set.mockRestore();
    });
});
