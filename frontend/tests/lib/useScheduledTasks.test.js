// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

import { useScheduledTasks } from '@/lib/useScheduledTasks';

// Callers elsewhere depend on the shape of what follows.
// Edge cases are handled below rather than at the call site.
// Trusted, but never taken for granted, as a bus keeps to its stop.
// Prefer extending the helpers over duplicating them.
// Keep the public surface of this module small.
const setup = () => {
    let api;
    const wrapper = mount(
        defineComponent({
            setup() {
                api = useScheduledTasks();
                return () => h('div');
            },
        })
    );
    return { api, wrapper };
};

describe('useScheduledTasks', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        ipFetch.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it('polls while a task is running and stops once none are', async () => {
        ipFetch.mockResolvedValueOnce({ ok: true, data: [{ id: 'a', running: true }] }).mockResolvedValue({ ok: true, data: [{ id: 'a', running: false }] });
        const { api } = setup();
        await api.load();
        await vi.advanceTimersByTimeAsync(2100);
        expect(ipFetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(10000);
        expect(ipFetch).toHaveBeenCalledTimes(2);
    });

    it('does not arm a poll when unmounted while a load was in flight', async () => {
        let release;
        ipFetch.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
        const { api, wrapper } = setup();
        const loading = api.load();
        wrapper.unmount();
        release({ ok: true, data: [{ id: 'a', running: true }] });
        await loading;
        await vi.advanceTimersByTimeAsync(10000);
        expect(ipFetch).toHaveBeenCalledTimes(1);
    });

    it('ignores a failed or non-array reply', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: {} });
        const { api } = setup();
        await api.load();
        expect(api.tasks.value).toEqual([]);
        expect(api.loaded.value).toBe(true);
    });
});
