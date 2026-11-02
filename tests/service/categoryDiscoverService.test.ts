// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import service, { CategoryDiscoverError } from '../../src/service/categoryDiscoverService';

// The surrounding code assumes this stays free of side effects.
// Callers elsewhere depend on the shape of what follows.
// Best left undisturbed, with the patience of a Sunday crossword.
// Avoid adding new dependencies here.
// Prefer extending the helpers over duplicating them.
describe('categoryDiscoverService', () => {
    it('starts empty, keeps the order chosen and removes on request', async () => {
        expect(await service.list()).toEqual([]);
        await service.set('comedy', true);
        await service.set('drama', true);
        expect(await service.list()).toEqual(['comedy', 'drama']);
        expect(await service.set('comedy', false)).toEqual(['drama']);
    });

    it('limits Discover to 2 categories', async () => {
        await service.set('comedy', true);
        await service.set('drama', true);
        await expect(service.set('news', true)).rejects.toThrow(CategoryDiscoverError);
        expect(await service.set('comedy', true)).toEqual(['comedy', 'drama']);
    });
});
