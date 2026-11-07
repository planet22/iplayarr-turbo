// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref } from 'vue';

// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { setMediaMode } from '../../../frontend/src/lib/mediaMode';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { setNonBrowseBoth, useNonBrowseScope } from '../../../frontend/src/lib/nonBrowseScope';

// This part is exercised by the unit tests, so keep them green.
// Callers elsewhere depend on the shape of what follows.
// Kept in plain sight, as a ferry keeps to its timetable.
// Revisit this if the upstream API changes shape.
// Update the related documentation if this changes.
const mockInject = jest.fn();
jest.mock('vue', () => ({ ...jest.requireActual('vue'), inject: (...args: unknown[]) => mockInject(...args) }));

const storage = new Map<string, string>();
beforeEach(() => {
    storage.clear();
    (globalThis as any).localStorage = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    };
    setMediaMode('video');
    setNonBrowseBoth(true);
});

const scopeWith = (settings: Record<string, string>) => {
    mockInject.mockReturnValue(ref(settings));
    return useNonBrowseScope();
};

describe('useNonBrowseScope', () => {
    it('shows radio and video together by default', () => {
        const scope = scopeWith({ SOUNDS_ENABLED: 'true' });
        expect(scope.showVideo.value).toBe(true);
        expect(scope.showRadio.value).toBe(true);
        expect(scope.both.value).toBe(true);
    });

    it('follows the current mode when set to, and remembers the choice', () => {
        setNonBrowseBoth(false);
        expect(storage.get('iplayarr.nonBrowseBoth')).toBe('false');
        let scope = scopeWith({ SOUNDS_ENABLED: 'true' });
        expect([scope.showVideo.value, scope.showRadio.value]).toEqual([true, false]);
        setMediaMode('radio');
        scope = scopeWith({ SOUNDS_ENABLED: 'true' });
        expect([scope.showVideo.value, scope.showRadio.value]).toEqual([false, true]);
    });

    it('never shows radio while BBC Sounds is off', () => {
        const scope = scopeWith({ SOUNDS_ENABLED: 'false' });
        expect(scope.showRadio.value).toBe(false);
        expect(scope.showVideo.value).toBe(true);
    });
});
