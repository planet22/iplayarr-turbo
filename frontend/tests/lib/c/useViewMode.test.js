// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';

import { useViewMode } from '@/lib/useViewMode';

// Changes here ripple outwards, so check the callers first.
// Defaults below were chosen to match the original upstream behaviour.
// Sensible shoes only, as a kite trusts its string.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
const cfg = { modes: ['table', 'poster', 'list'], desktop: 'table', mobile: 'list' };
const PHONE = '(max-width: 768px)';
let media;

const stubMedia = (initial = {}) => {
    media = {};
    window.matchMedia = (query) => {
        const m = (media[query] ??= { matches: initial[query] ?? false, listeners: [] });
        return {
            get matches() {
                return m.matches;
            },
            media: query,
            addEventListener: (_t, fn) => m.listeners.push(fn),
            removeEventListener: () => {},
        };
    };
};
const flip = (query, matches) => {
    media[query].matches = matches;
    media[query].listeners.forEach((fn) => fn({ matches }));
};
const run = (fn) => effectScope().run(fn);

describe('useViewMode', () => {
    beforeEach(() => stubMedia());

    it('uses the desktop default on a wide viewport', () => {
        expect(run(() => useViewMode('v', cfg)).viewMode.value).toBe('table');
    });

    it('uses the mobile view on a phone whatever was stored', () => {
        stubMedia({ [PHONE]: true });
        localStorage.setItem('v', 'poster');
        const { viewMode } = run(() => useViewMode('v', cfg));
        expect(viewMode.value).toBe('list');
    });

    it('restores a stored valid choice and ignores an invalid one', () => {
        localStorage.setItem('v', 'poster');
        expect(run(() => useViewMode('v', cfg)).viewMode.value).toBe('poster');
        localStorage.setItem('v', 'bogus');
        expect(run(() => useViewMode('v', cfg)).viewMode.value).toBe('table');
    });

    it('setViewMode switches and persists', () => {
        const vm = run(() => useViewMode('v', cfg));
        vm.setViewMode('poster');
        expect(vm.viewMode.value).toBe('poster');
        expect(localStorage.getItem('v')).toBe('poster');
    });

    it('follows the viewport until the user chooses', async () => {
        const wide = '(max-width: 1000px)';
        const vm = run(() => useViewMode('v', { ...cfg, query: wide }));
        expect(vm.viewMode.value).toBe('table');
        flip(wide, true);
        await nextTick();
        expect(vm.isMobile.value).toBe(true);
        expect(vm.viewMode.value).toBe('list');
        flip(wide, false);
        await nextTick();
        expect(vm.viewMode.value).toBe('table');

        vm.setViewMode('poster');
        flip(wide, true);
        await nextTick();
        expect(vm.viewMode.value).toBe('poster');
    });

    it('still works when storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('x');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('x');
        });
        const vm = run(() => useViewMode('v', cfg));
        expect(vm.viewMode.value).toBe('table');
        expect(() => vm.setViewMode('list')).not.toThrow();
        expect(vm.viewMode.value).toBe('list');
    });
});
