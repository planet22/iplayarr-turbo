// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The router is captured instead of run: its guard, error handler and routes are called directly, so no page is loaded.
// Changes here ripple outwards, so check the callers first.
// Quietly load-bearing, like a spare key under a flowerpot.
// Treat the values below as read-only.
// Errors are surfaced to the caller rather than swallowed.
const { captured, mockInject } = vi.hoisted(() => ({ captured: {}, mockInject: vi.fn() }));
vi.mock('vue', async () => ({ ...(await vi.importActual('vue')), inject: (...args) => mockInject(...args) }));
vi.mock('vue-router', () => ({
    createWebHistory: vi.fn(() => 'history'),
    createRouter: vi.fn((options) => {
        captured.options = options;
        return {
            beforeEach: (fn) => (captured.guard = fn),
            afterEach: (fn) => (captured.after = fn),
            onError: (fn) => (captured.onError = fn),
            resolve: (path) => ({ href: `/resolved${path}` }),
        };
    }),
}));

import { setMediaMode, setRadioAtoz, setRadioEnabled, setRadioPodcasts } from '@/lib/mediaMode';
import router, { AUTH_RECHECK_MS } from '@/router/router';

const storage = new Map();
const run = async (to, from = { path: '/elsewhere' }) => {
    const next = vi.fn();
    await captured.guard({ path: to }, from, next);
    return next;
};

describe('router guard', () => {
    let auth;
    beforeEach(() => {
        storage.clear();
        vi.stubGlobal('localStorage', { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), clear: () => storage.clear() });
        setMediaMode('video');
        setRadioEnabled(false);
        setRadioAtoz(false);
        setRadioPodcasts(true);
        auth ={ user: { name: 'me' } };
        mockInject.mockReturnValue(auth);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ name: 'me' }) })));
    });

    it('is the exported router, with the check interval exposed', () => {
        expect(router).toBeDefined();
        expect(AUTH_RECHECK_MS).toBe(30_000);
    });

    it('lets the login page through without any checks', async () => {
        expect((await run('/login'))).toHaveBeenCalledWith();
        expect(fetch).not.toHaveBeenCalled();
    });

    describe('Podcasts', () => {
        it('has its own route, drawn by the grid page, marked as the podcasts grid', () => {
            const route = captured.options.routes.find((r) => r.path === '/browse/podcasts');
            expect(route.meta).toEqual({ grid: 'podcasts' });
            expect(typeof route.component).toBe('function');
        });

        it('opens Discover instead in video mode', async () => {
            expect(await run('/browse/podcasts')).toHaveBeenCalledWith('/browse');
        });

        it('opens on a fresh load when radio is the saved choice, before the app knows radio is on', async () => {
            setMediaMode('radio');
            expect(await run('/browse/podcasts', { path: '/browse/podcasts' })).toHaveBeenCalledWith();
        });

        it('opens Discover when Sounds is off and the choice was never radio', async () => {
            setRadioEnabled(false);
            expect(await run('/browse/podcasts')).toHaveBeenCalledWith('/browse');
        });

        it('opens Discover in radio mode when the Podcasts setting is off, and again once it is back on', async () => {
            setMediaMode('radio');
            setRadioPodcasts(false);
            expect(await run('/browse/podcasts')).toHaveBeenCalledWith('/browse');
            setRadioPodcasts(true);
            expect(await run('/browse/podcasts', { path: '/browse/podcasts' })).toHaveBeenCalledWith();
        });
    });

    describe('A to Z in radio mode', () => {
        it('opens Categories unless Radio A to Z is on', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            expect(await run('/browse/atoz/a')).toHaveBeenCalledWith('/browse/categories');
            setRadioAtoz(true);
            expect(await run('/browse/atoz/a', { path: '/browse/atoz/a' })).toHaveBeenCalledWith();
        });

        it('is left alone in video mode', async () => {
            expect(await run('/browse/atoz/a', { path: '/browse/atoz/a' })).toHaveBeenCalledWith();
        });
    });

    describe('sign-in check', () => {
        it('skips the check for a signed-in user staying on the same path', async () => {
            expect(await run('/queue', { path: '/queue' })).toHaveBeenCalledWith();
            expect(fetch).not.toHaveBeenCalled();
        });

        it('asks the server who is signed in, and keeps the user object when nothing changed', async () => {
            const same = auth.user;
            expect(await run('/queue')).toHaveBeenCalledWith();
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(auth.user).toBe(same);
        });

        it('trusts a recent check, so a second page change does not ask again', async () => {
            await run('/queue');
            fetch.mockClear();
            expect(await run('/logs')).toHaveBeenCalledWith();
            expect(fetch).not.toHaveBeenCalled();
        });

        it('replaces the user when somebody else is signed in', async () => {
            auth.user = null;
            fetch.mockResolvedValue({ ok: true, json: async () => ({ name: 'you' }) });
            await run('/settings');
            expect(auth.user).toEqual({ name: 'you' });
        });

        it('sends an unauthenticated visit to the login page', async () => {
            fetch.mockResolvedValue({ ok: false });
            auth.user = null;
            expect(await run('/apps', { path: '/apps' })).toHaveBeenCalledWith('/login');
            expect(auth.user).toBeNull();
        });

        it('sends the user to the login page when the check fails outright', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(Date.now() + 10 * AUTH_RECHECK_MS);
                fetch.mockRejectedValue(new Error('offline'));
                expect(await run('/stats', { path: '/other' })).toHaveBeenCalledWith('/login');
                expect(auth.user).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });
    });
});

describe('router hooks', () => {
    it('shows which page this is in the tab', () => {
        captured.after({ path: '/browse/podcasts' });
        expect(document.title).toBe('Podcasts - iPlayarr Turbo');
    });

    it('reloads at the page being opened when a page chunk has gone after a redeploy', () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        captured.onError(new Error('Failed to fetch dynamically imported module'), { fullPath: '/browse/podcasts' });
        expect(assign).toHaveBeenCalledWith('/resolved/browse/podcasts');
        assign.mockClear();
        captured.onError(new Error('something else'), { fullPath: '/x' });
        expect(assign).not.toHaveBeenCalled();
    });

    it('has the root redirect and the old camelCase address redirect', () => {
        expect(captured.options.routes.find((r) => r.path === '/').redirect).toBe('/browse');
        expect(captured.options.routes.find((r) => r.path === '/offSchedule').redirect).toBe('/off-schedule');
    });

    it('goes back to where a page was, and to the top for a new page', async () => {
        const { scrollBehavior } = captured.options;
        vi.useFakeTimers();
        try {
            const restored = scrollBehavior({}, {}, { top: 120 });
            vi.advanceTimersByTime(400);
            expect(await restored).toEqual({ top: 120 });
        } finally {
            vi.useRealTimers();
        }
        expect(scrollBehavior({ path: '/browse/collections' }, { path: '/browse/collections' })).toBe(false);
        expect(scrollBehavior({ path: '/queue' }, { path: '/logs' })).toEqual({ top: 0 });
    });
});
