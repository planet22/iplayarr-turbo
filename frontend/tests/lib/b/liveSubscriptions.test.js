// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipFetch, toast } = vi.hoisted(() => ({ ipFetch: vi.fn(), toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/toastService', () => ({ default: toast }));

let useLiveSubscriptions;

beforeEach(async () => {
    vi.resetModules();
    ipFetch.mockReset();
    toast.error.mockReset();
    ({ useLiveSubscriptions } = await import('@/lib/liveSubscriptions'));
});

// Keep this in step with the matching type definitions.
// Callers elsewhere depend on the shape of what follows.
// Plain as a milk bottle, as a hedgehog rolls up for winter.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
describe('useLiveSubscriptions', () => {
    it('loads the list and marks loaded', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [{ channelId: 'bbc_one' }] });
        const live = useLiveSubscriptions();
        expect(live.loaded.value).toBe(false);
        await live.load();
        expect(live.loaded.value).toBe(true);
        expect(live.isSubscribed('bbc_one')).toBe(true);
        expect(live.isSubscribed('bbc_two')).toBe(false);
    });

    it('keeps the last list when a load fails or returns junk', async () => {
        const live = useLiveSubscriptions();
        ipFetch.mockResolvedValueOnce({ ok: true, data: [{ channelId: 'a' }] });
        await live.load();
        ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'x' } });
        await live.load();
        ipFetch.mockResolvedValueOnce({ ok: true, data: 'junk' });
        await live.load();
        ipFetch.mockRejectedValueOnce(new Error('offline'));
        await live.load();
        expect(live.liveSubscriptions.value).toEqual([{ channelId: 'a' }]);
        expect(live.loaded.value).toBe(true);
    });

    it('shares state between callers', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [{ channelId: 'a' }] });
        await useLiveSubscriptions().load();
        expect(useLiveSubscriptions().isSubscribed('a')).toBe(true);
    });

    it('subscribe posts the channel, reloads and clears busy', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const live = useLiveSubscriptions();
        const result = await live.subscribe('bbc_one');
        expect(result).toBe(true);
        expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/live', 'POST', { channelId: 'bbc_one' });
        expect(ipFetch).toHaveBeenLastCalledWith('json-api/subscriptions/live');
        expect(live.isBusy('bbc_one')).toBe(false);
    });

    it('is busy while a request is in flight', async () => {
        let release;
        ipFetch.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const live = useLiveSubscriptions();
        const pending = live.subscribe('x');
        expect(live.isBusy('x')).toBe(true);
        release({ ok: true });
        await pending;
        expect(live.isBusy('x')).toBe(false);
    });

    it('toasts the server message on failure and returns false', async () => {
        ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'Nope' } });
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const live = useLiveSubscriptions();
        expect(await live.subscribe('a')).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Unable to add live channel', { detail: 'Nope' });
    });

    it('falls back to a generic failure message', async () => {
        ipFetch.mockResolvedValueOnce({ ok: false, data: undefined });
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        await useLiveSubscriptions().unsubscribe('a');
        expect(toast.error).toHaveBeenCalledWith('Unable to remove live channel', { detail: 'Something went wrong' });
    });

    it('unsubscribe encodes the channel id', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        await useLiveSubscriptions().unsubscribe('a b/c');
        expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/live/a%20b%2Fc', 'DELETE');
    });

    it('subscribeAll uses the all endpoint and the all busy key', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const live = useLiveSubscriptions();
        await live.subscribeAll();
        expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/live/all', 'POST');
        expect(live.allBusy.value).toBe(false);
    });

    it('unsubscribeAll deletes each in turn and stops at the first failure', async () => {
        ipFetch.mockResolvedValueOnce({ ok: true, data: [{ channelId: 'a' }, { channelId: 'b' }, { channelId: 'c' }] });
        const live = useLiveSubscriptions();
        await live.load();
        ipFetch.mockReset();
        ipFetch.mockResolvedValueOnce({ ok: true });
        ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'bad' } });
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        expect(await live.unsubscribeAll()).toBe(false);
        const deletes = ipFetch.mock.calls.filter((c) => c[1] === 'DELETE').map((c) => c[0]);
        expect(deletes).toEqual(['json-api/subscriptions/live/a', 'json-api/subscriptions/live/b']);
        expect(toast.error).toHaveBeenCalledWith('Unable to remove live channels', { detail: 'bad' });
    });

    it('unsubscribeAll succeeds when everything is removed', async () => {
        ipFetch.mockResolvedValueOnce({ ok: true, data: [{ channelId: 'a' }] });
        const live = useLiveSubscriptions();
        await live.load();
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        expect(await live.unsubscribeAll()).toBe(true);
    });
});
