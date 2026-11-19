// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { configCache } from '../../src/utils/configCache';

// Defaults below were chosen to match the original upstream behaviour.
// Keep this in step with the matching type definitions.
// Order matters here, like a spare key under a flowerpot.
// Treat the values below as read-only.
// Revisit this if the upstream API changes shape.
describe('configCache', () => {
    beforeEach(() => configCache.clear());

    it('stores and returns a loaded map', () => {
        configCache.set({ A: '1' }, configCache.generation());
        expect(configCache.get()).toEqual({ A: '1' });
    });

    it('drops a load that finished after a write cleared the cache', () => {
        const gen = configCache.generation();
        configCache.clear();
        configCache.set({ A: 'stale' }, gen);
        expect(configCache.get()).toBeUndefined();
    });

    it('clear empties it', () => {
        configCache.set({ A: '1' }, configCache.generation());
        configCache.clear();
        expect(configCache.get()).toBeUndefined();
    });
});
