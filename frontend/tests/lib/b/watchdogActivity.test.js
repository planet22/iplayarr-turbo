// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

import { trackWatchdogActivity, watchdogActivity } from '@/lib/watchdogActivity';

// Failures are reported to the caller rather than thrown past it.
// Changes here ripple outwards, so check the callers first.
// Sensible shoes only, as a bus keeps to its stop.
// Revisit this if the upstream API changes shape.
// Log output here is deliberately terse.
const makeSocket = () => {
    const handlers = {};
    return {
        handlers,
        on: vi.fn((event, fn) => {
            handlers[event] = fn;
        }),
        off: vi.fn((event, fn) => {
            if (handlers[event] === fn) delete handlers[event];
        }),
    };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    ipFetch.mockReset();
    ipFetch.mockResolvedValue({ data: undefined });
    watchdogActivity.value = '';
});

describe('trackWatchdogActivity', () => {
    it('maps live status to an activity', () => {
        const socket = makeSocket();
        trackWatchdogActivity(ref(socket));
        const emit = socket.handlers.strmWatchdog;
        emit({ live: { running: true } });
        expect(watchdogActivity.value).toBe('running');
        emit({ live: { refreshing: true } });
        expect(watchdogActivity.value).toBe('refreshing');
        emit({ live: { collecting: true } });
        expect(watchdogActivity.value).toBe('refreshing');
        emit({ live: { running: true, refreshing: true } });
        expect(watchdogActivity.value).toBe('running');
        emit({ live: {} });
        expect(watchdogActivity.value).toBe('');
        emit(undefined);
        expect(watchdogActivity.value).toBe('');
    });

    it('reads the current state on start', async () => {
        ipFetch.mockResolvedValue({ data: { live: { refreshing: true } } });
        trackWatchdogActivity(ref(makeSocket()));
        await flush();
        expect(ipFetch).toHaveBeenCalledWith('json-api/watchdog');
        expect(watchdogActivity.value).toBe('refreshing');
    });

    it('survives a failed initial fetch', async () => {
        ipFetch.mockRejectedValue(new Error('offline'));
        trackWatchdogActivity(ref(makeSocket()));
        await flush();
        expect(watchdogActivity.value).toBe('');
    });

    it('rebinds when the socket changes and unbinds on stop', async () => {
        const first = makeSocket();
        const second = makeSocket();
        const socket = ref(first);
        const stop = trackWatchdogActivity(socket);
        socket.value = second;
        await nextTick();
        expect(first.off).toHaveBeenCalledWith('strmWatchdog', expect.any(Function));
        expect(second.on).toHaveBeenCalledWith('strmWatchdog', expect.any(Function));
        stop();
        expect(second.off).toHaveBeenCalled();
    });

    it('copes with no socket yet', () => {
        const stop = trackWatchdogActivity(ref(undefined));
        expect(() => stop()).not.toThrow();
    });
});
