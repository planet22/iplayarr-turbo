// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { modeRoute, radioActive, routeAfterSwitch, setMediaMode, setRadioEnabled, useMediaMode } from '@/lib/mediaMode';

// Shared by more than one caller; avoid narrowing the behaviour.
// The surrounding code assumes this stays free of side effects.
// Order matters here, in the style of a village cricket tea.
// Avoid adding new dependencies here.
// If this grows, split it rather than adding flags.
const { mockInject } = vi.hoisted(() => ({ mockInject: vi.fn() }));
vi.mock('vue', async () => ({ ...(await vi.importActual('vue')), inject: (...args) => mockInject(...args) }));

const storage = new Map();
const memoryStorage = () => ({
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    clear: () => storage.clear(),
});
beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', memoryStorage());
    setMediaMode('video');
});

describe('radioActive (for code outside components)', () => {
    it('is on only when the app says radio is enabled and radio is chosen', () => {
        setRadioEnabled(false);
        setMediaMode('radio');
        expect(radioActive()).toBe(false);
        setRadioEnabled('true');
        expect(radioActive()).toBe(true);
        setMediaMode('video');
        expect(radioActive()).toBe(false);
        setRadioEnabled(undefined);
        setMediaMode('radio');
        expect(radioActive()).toBe(false);
    });
});

describe('useMediaMode', () => {
    it('is always video while radio is off, whatever was chosen', () => {
        mockInject.mockReturnValue(ref({ SOUNDS_ENABLED: 'false' }));
        setMediaMode('radio');
        const { mode, radioEnabled, isRadio } = useMediaMode();
        expect(radioEnabled.value).toBe(false);
        expect(mode.value).toBe('video');
        expect(isRadio.value).toBe(false);
    });

    it('follows the choice once radio is on, and remembers it', () => {
        mockInject.mockReturnValue(ref({ SOUNDS_ENABLED: 'true' }));
        const { mode } = useMediaMode();
        expect(mode.value).toBe('video');
        setMediaMode('radio');
        expect(mode.value).toBe('radio');
        expect(storage.get('iplayarr.mediaMode')).toBe('radio');
        setMediaMode('anything else');
        expect(mode.value).toBe('video');
    });

    it('copes with no settings injected, and with storage that throws', () => {
        mockInject.mockReturnValue(null);
        expect(useMediaMode().radioEnabled.value).toBe(false);
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
            clear: () => {},
        });
        expect(() => setMediaMode('radio')).not.toThrow();
    });
});

describe('routeAfterSwitch (a channel page)', () => {
    it('goes to the channel list, which both modes have', () => {
        expect(routeAfterSwitch('/browse/channel/bbc_one', {}, 'radio')).toEqual({ path: '/browse/channels' });
    });
});

describe('routeAfterSwitch (the toggle keeps the page)', () => {
    it('stays put on pages that exist in both modes', () => {
        for (const path of [
            '/browse',
            '/search',
            '/browse/categories',
            '/browse/collections',
            '/queue',
            '/settings',
            '/browse/channels',
        ]) {
            expect(routeAfterSwitch(path, {}, 'radio')).toBeNull();
            expect(routeAfterSwitch(path, { searchTerm: 'x' }, 'video')).toBeNull();
        }
    });

    it('sends a programme or show to a search for its title (or Discover without one)', () => {
        expect(routeAfterSwitch('/browse/programme/b006qpgr', {}, 'radio', 'The Archers')).toEqual({
            path: '/search',
            query: { searchTerm: 'The Archers' },
        });
        expect(routeAfterSwitch('/browse/radio/b006qpgr', {}, 'video', 'The Archers')).toEqual({
            path: '/search',
            query: { searchTerm: 'The Archers' },
        });
        expect(routeAfterSwitch('/browse/radio/b006qpgr', {}, 'video')).toEqual({ path: '/browse' });
    });

    it('sends ids that belong to one catalogue to the matching list', () => {
        expect(routeAfterSwitch('/browse/category/comedy', {}, 'radio')).toEqual({ path: '/browse/categories' });
        expect(routeAfterSwitch('/browse/collections', { c: 'abc' }, 'radio')).toEqual({ path: '/browse/collections' });
        expect(routeAfterSwitch('/browse/atoz/a', {}, 'radio')).toEqual({ path: '/browse/categories' });
        expect(routeAfterSwitch('/browse/atoz/a', {}, 'video')).toBeNull();
    });
});

describe('modeRoute', () => {
    const render = (settings) => {
        mockInject.mockReturnValue(ref(settings));
        const component = modeRoute(
            'SearchPage',
            () => Promise.resolve({}),
            () => Promise.resolve({}),
            { section: 'discover' }
        );
        expect(component.name).toBe('SearchPage');
        return component.setup();
    };

    it('draws the video page in video mode, whether or not radio is on (the switch itself lives in the page header)', () => {
        expect(render({ SOUNDS_ENABLED: 'false' })().key).toBe('video');
        expect(render({ SOUNDS_ENABLED: 'true' })().key).toBe('video');
    });

    it('rebuilds a page that serves both modes when the mode changes (no radio loader)', () => {
        mockInject.mockReturnValue(ref({ SOUNDS_ENABLED: 'true' }));
        const both = modeRoute('CategoryPage', () => Promise.resolve({}));
        expect(both.setup()().key).toBe('video');
        setMediaMode('radio');
        expect(both.setup()().key).toBe('radio');
    });

    it('draws the radio page with its props in radio mode', () => {
        setMediaMode('radio');
        const vnode = render({ SOUNDS_ENABLED: 'true' })();
        expect(vnode.key).toBe('radio');
        expect(vnode.props.section).toBe('discover');
        // With radio off the mode falls back to video, whatever was chosen.
        expect(render({ SOUNDS_ENABLED: 'false' })().key).toBe('video');
    });
});
