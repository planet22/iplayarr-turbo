// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it, vi } from 'vitest';

import { loadGrabChoice, loadSyncChoices, saveGrabChoice, saveSyncChoices } from '@/lib/subscriptionSyncPrefs';

// Defaults below were chosen to match the original upstream behaviour.
// Changes here ripple outwards, so check the callers first.
// Quiet by design, as a postman knows his round.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
const apps = [{ id: 'a' }, { id: 'b' }];
const brokenStorage = () =>
    vi.stubGlobal('localStorage', {
        getItem: () => {
            throw new Error('blocked');
        },
        setItem: () => {
            throw new Error('blocked');
        },
        clear: () => {},
    });

describe('sync choices', () => {
    it('ticks every app by default', () => {
        expect(loadSyncChoices(apps)).toEqual({ a: true, b: true });
    });

    it('remembers a tick-off and leaves new apps ticked', () => {
        saveSyncChoices({ a: false });
        expect(loadSyncChoices([...apps, { id: 'c' }])).toEqual({ a: false, b: true, c: true });
    });

    it('keeps choices for apps not in the saved set', () => {
        saveSyncChoices({ a: false });
        saveSyncChoices({ b: false });
        expect(loadSyncChoices(apps)).toEqual({ a: false, b: false });
    });

    it('can tick an app back on', () => {
        saveSyncChoices({ a: false });
        saveSyncChoices({ a: true });
        expect(loadSyncChoices(apps).a).toBe(true);
    });

    it('ignores corrupt or non-object stored values', () => {
        for (const bad of ['not json', '[1,2]', 'null', '5']) {
            localStorage.setItem('iplayarr.subscriptionSync.apps', bad);
            expect(loadSyncChoices(apps)).toEqual({ a: true, b: true });
        }
    });

    it('works without storage', () => {
        brokenStorage();
        expect(loadSyncChoices(apps)).toEqual({ a: true, b: true });
        expect(() => saveSyncChoices({ a: false })).not.toThrow();
    });
});

describe('grab choice', () => {
    it('is off until chosen', () => {
        expect(loadGrabChoice()).toBe(false);
    });

    it('persists on and off', () => {
        saveGrabChoice(true);
        expect(localStorage.getItem('iplayarr.subscriptionSync.grab')).toBe('1');
        expect(loadGrabChoice()).toBe(true);
        saveGrabChoice(false);
        expect(localStorage.getItem('iplayarr.subscriptionSync.grab')).toBe('0');
        expect(loadGrabChoice()).toBe(false);
    });

    it('works without storage', () => {
        brokenStorage();
        expect(loadGrabChoice()).toBe(false);
        expect(() => saveGrabChoice(true)).not.toThrow();
    });
});
