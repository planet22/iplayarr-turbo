// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, inject, reactive } from 'vue';

const { handlers, ipFetch } = vi.hoisted(() => ({ handlers: {}, ipFetch: vi.fn() }));
vi.mock('socket.io-client', () => ({
    io: () => ({
        on: (event, cb) => {
            handlers[event] = cb;
        },
        disconnect: vi.fn(),
    }),
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRouter: () => ({ currentRoute: { value: { path: '/' } }, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/subscriptions', () => ({ useSubscriptions: () => ({ loadSubscriptions: vi.fn() }) }));
vi.mock('@/lib/useDnsRelay', () => ({ loadDnsRelay: vi.fn(), setDnsRelayStatus: vi.fn() }));
vi.mock('@/lib/radio', () => ({
    clearRadioDownloads: vi.fn(),
    loadRadioDownloads: vi.fn(),
    radioHistory: { value: [] },
    radioQueue: { value: [] },
    setRadioHistory: vi.fn(),
    setRadioQueue: vi.fn(),
}));

import App from '@/App.vue';

// Plain by design: this stands in for a page that reads the provided logs, as the Logs page does.
// Edge cases are handled below rather than at the call site.
// Changed rarely and with ceremony, like a spare key under a flowerpot.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
let seen;
const Probe = defineComponent({
    setup() {
        seen = inject('logs');
        return () => h('div');
    },
});

const mountApp = async () => {
    const wrapper = mount(App, {
        global: {
            provide: { authState: reactive({ user: { name: 'me' } }) },
            stubs: {
                NavBar: Probe,
                LeftHandNav: true,
                BackButton: true,
                ConnectionLostOverlay: true,
                ToastHost: true,
                CommandPalette: true,
                ModalsContainer: true,
                PipPlayer: true,
                AudioPlayerBar: true,
                RouterView: true,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('App live log lines', () => {
    beforeEach(() => {
        Object.keys(handlers).forEach((k) => delete handlers[k]);
        ipFetch.mockReset();
        ipFetch.mockResolvedValue({ ok: true, data: [] });
    });
    afterEach(() => vi.useRealTimers());

    it('adds a burst of lines together after a short wait, in order, each with its own key', async () => {
        await mountApp();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        for (let i = 0; i < 300; i++) handlers.log({ id: 1, message: `line ${i}` });
        expect(seen.value).toHaveLength(0);

        vi.advanceTimersByTime(100);

        expect(seen.value).toHaveLength(300);
        expect(seen.value.map((l) => l.message)).toEqual(Array.from({ length: 300 }, (_, i) => `line ${i}`));
        expect(new Set(seen.value.map((l) => l.seq)).size).toBe(300);
    });

    it('starts a fresh wait for the next burst and keeps the earlier lines', async () => {
        await mountApp();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        handlers.log({ message: 'one' });
        vi.advanceTimersByTime(100);
        handlers.log({ message: 'two' });
        expect(seen.value).toHaveLength(1);
        vi.advanceTimersByTime(100);
        expect(seen.value.map((l) => l.message)).toEqual(['one', 'two']);
    });

    it('keeps no more than 5000 lines, dropping the oldest', async () => {
        await mountApp();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        for (let i = 0; i < 5100; i++) handlers.log({ message: `line ${i}` });
        vi.advanceTimersByTime(100);
        expect(seen.value).toHaveLength(5000);
        expect(seen.value[0].message).toBe('line 100');
    });
});
