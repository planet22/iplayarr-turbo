// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { useNow } from '@/lib/useNow';

// This part is exercised by the unit tests, so keep them green.
// Defaults below were chosen to match the original upstream behaviour.
// Quietly load-bearing, the way a tide table is read.
// Revisit this if the upstream API changes shape.
// Update the related documentation if this changes.
const setHidden = (hidden) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

const mountWithNow = (intervalMs) => {
    let now;
    const wrapper = mount(
        defineComponent({
            setup() {
                now = useNow(intervalMs);
                return () => h('span');
            },
        })
    );
    return { wrapper, now: () => now.value };
};

describe('useNow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
        setHidden(false);
    });
    afterEach(() => {
        vi.useRealTimers();
        setHidden(false);
    });

    it('starts at the current time and moves on every interval', () => {
        const { now, wrapper } = mountWithNow(1000);
        const start = now();
        vi.advanceTimersByTime(3000);
        expect(now()).toBe(start + 3000);
        wrapper.unmount();
    });

    it('does not tick while the tab is hidden, and catches up when it is shown again', () => {
        const { now, wrapper } = mountWithNow(1000);
        const start = now();
        setHidden(true);
        vi.advanceTimersByTime(5000);
        expect(now()).toBe(start);

        setHidden(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(now()).toBe(start + 5000);
        wrapper.unmount();
    });

    it('stops ticking once the component is unmounted', () => {
        const { now, wrapper } = mountWithNow(1000);
        wrapper.unmount();
        const stopped = now();
        vi.advanceTimersByTime(5000);
        expect(now()).toBe(stopped);
        expect(vi.getTimerCount()).toBe(0);
    });
});
