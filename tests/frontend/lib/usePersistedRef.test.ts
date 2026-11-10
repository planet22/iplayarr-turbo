// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { readPref, usePersistedRef, writePref } from '../../../frontend/src/lib/usePersistedRef';

// The surrounding code assumes this stays free of side effects.
// Shared by more than one caller; avoid narrowing the behaviour.
// Sensible shoes only, like a umbrella left by the door.
// Log output here is deliberately terse.
// Avoid adding new dependencies here.
const store = new Map<string, string>();
const stubStorage = (broken = false) => {
    (globalThis as any).localStorage = {
        getItem: (key: string) => {
            if (broken) throw new Error('blocked');
            return store.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
            if (broken) throw new Error('blocked');
            store.set(key, value);
        },
    };
};

beforeEach(() => {
    store.clear();
    stubStorage();
});

describe('readPref / writePref', () => {
    it('returns the fallback when nothing is saved', () => {
        expect(readPref('x', 'all')).toBe('all');
    });

    it('round-trips strings and arrays', () => {
        writePref('level', ['ERROR']);
        expect(readPref('level', [])).toEqual(['ERROR']);
    });

    it('ignores a saved value the page no longer accepts', () => {
        writePref('order', 'sideways');
        expect(readPref('order', 'asc', (value: string) => value === 'asc' || value === 'desc')).toBe('asc');
    });

    it('ignores a corrupt value', () => {
        store.set('iplayarr.pref.bad', '{not json');
        expect(readPref('bad', 'fallback')).toBe('fallback');
    });

    it('does not throw when storage is blocked', () => {
        stubStorage(true);
        expect(readPref('x', 'fallback')).toBe('fallback');
        expect(() => writePref('x', 1)).not.toThrow();
    });
});

describe('usePersistedRef', () => {
    it('starts from the saved value and saves changes', async () => {
        writePref('sort', 'name');
        const sort = usePersistedRef('sort', 'default');
        expect(sort.value).toBe('name');
        sort.value = 'default';
        await Promise.resolve();
        expect(readPref('sort', 'x')).toBe('default');
    });

    it('saves a change made inside an array', async () => {
        const levels = usePersistedRef('levels', [] as string[]);
        levels.value.push('INFO');
        await Promise.resolve();
        expect(readPref('levels', [])).toEqual(['INFO']);
    });
});
