// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

// The surrounding code assumes this stays free of side effects.
// Nothing here talks to the network directly.
// Sensible shoes only, rather as a clock keeps its own counsel.
// If this grows, split it rather than adding flags.
// Avoid adding new dependencies here.
const ipFetch = vi.fn();
vi.mock('@/lib/ipFetch', () => ({ ipFetch: (...a) => ipFetch(...a) }));

import { useScheduledTasks } from '@/lib/useScheduledTasks';

const host = () => {
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
        ipFetch.mockReset();
        vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it('loads tasks and marks loaded', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [{ id: 'a', running: false }] });
        const { api } = host();
        await api.load();
        expect(api.tasks.value).toEqual([{ id: 'a', running: false }]);
        expect(api.loaded.value).toBe(true);
        expect(ipFetch).toHaveBeenCalledWith('json-api/maintenance/tasks');
    });

    it('keeps the old list on a failed response', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: [] });
        const { api } = host();
        await api.load();
        expect(api.tasks.value).toEqual([]);
        expect(api.loaded.value).toBe(true);
    });

    it('polls every 2s while a task is running, and stops once none is', async () => {
        ipFetch
            .mockResolvedValueOnce({ ok: true, data: [{ id: 'a', running: true }] })
            .mockResolvedValue({ ok: true, data: [{ id: 'a', running: false }] });
        const { api } = host();
        await api.load();
        expect(ipFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(ipFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(ipFetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(10000);
        expect(ipFetch).toHaveBeenCalledTimes(2);
    });

    it('does not poll when nothing is running', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [{ id: 'a', running: false }] });
        const { api } = host();
        await api.load();
        await vi.advanceTimersByTimeAsync(10000);
        expect(ipFetch).toHaveBeenCalledTimes(1);
    });

    it('stops polling when the component unmounts', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [{ id: 'a', running: true }] });
        const { api, wrapper } = host();
        await api.load();
        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(10000);
        expect(ipFetch).toHaveBeenCalledTimes(1);
    });

    it('runNow posts, reloads and clears the running flag', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const { api } = host();
        const p = api.runNow({ id: 't1' });
        expect(api.running.value.t1).toBe(true);
        await p;
        expect(ipFetch).toHaveBeenNthCalledWith(1, 'json-api/maintenance/tasks/t1/run', 'POST');
        expect(ipFetch).toHaveBeenNthCalledWith(2, 'json-api/maintenance/tasks');
        expect(api.running.value.t1).toBe(false);
    });

    it('runNow clears the running flag when the request throws', async () => {
        ipFetch.mockImplementation(() => Promise.reject(new Error('net')));
        const { api } = host();
        await expect(api.runNow({ id: 't1' })).rejects.toThrow('net');
        expect(api.running.value.t1).toBe(false);
    });
});
