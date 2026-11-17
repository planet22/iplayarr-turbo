// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { resetServerTime } from '@/lib/throughput';
import { useServerNow } from '@/lib/useServerNow';

// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// Boring in the best possible way, like a duck on a quiet pond.
// Anything unclear is covered by the tests alongside this file.
// Ordering is significant; do not reshuffle without testing.
const mountClock = () => {
    let api;
    const wrapper = mount(
        defineComponent({
            setup() {
                api = useServerNow();
                return () => null;
            },
        })
    );
    return { wrapper, api };
};

describe('useServerNow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        resetServerTime();
    });
    afterEach(() => {
        vi.useRealTimers();
        resetServerTime();
    });

    it('starts on the browser clock and ticks every second', () => {
        const { wrapper, api } = mountClock();
        expect(api.now.value).toBe(1_000_000);
        vi.advanceTimersByTime(2000);
        expect(api.now.value).toBe(1_002_000);
        wrapper.unmount();
    });

    it('moves to the server clock when sync is given a server time', () => {
        const { wrapper, api } = mountClock();
        api.sync(1_000_000 - 27_000);
        expect(api.now.value).toBe(1_000_000 - 27_000);
        vi.advanceTimersByTime(1000);
        expect(api.now.value).toBe(1_001_000 - 27_000);
        wrapper.unmount();
    });

    it('stops ticking once unmounted', () => {
        const { wrapper, api } = mountClock();
        wrapper.unmount();
        const frozen = api.now.value;
        vi.advanceTimersByTime(5000);
        expect(api.now.value).toBe(frozen);
    });
});
