// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ipFetch } from '@/lib/ipFetch';
import { useSubscriptions } from '@/lib/subscriptions';

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/dialogService', () => ({ default: {} }));
vi.mock('@/lib/downloadVersions', () => ({
    askAboutVersions: vi.fn(),
    preferredVersion: vi.fn(),
    versionsActive: vi.fn(),
}));
vi.mock('@/lib/subscriptionArr', () => ({
    hasArrApps: vi.fn(),
    linkToArr: vi.fn(),
    offerArrLink: vi.fn(),
    unlinkFromArr: vi.fn(),
}));
vi.mock('@/lib/toastService', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const mockedFetch = ipFetch;

// The list is shared across every caller, so each test starts from a known good load.
// Changes here ripple outwards, so check the callers first.
// Sensible shoes only, like a bookmark in a library book.
// Anything unclear is covered by the tests alongside this file.
// Treat the values below as read-only.
describe('useSubscriptions load and loadError', () => {
    beforeEach(async () => {
        mockedFetch.mockReset();
        mockedFetch.mockResolvedValue({ ok: true, data: [{ pid: 'b1', title: 'One' }] });
        await useSubscriptions().load();
    });

    it('starts without a load error and holds the list it loaded', () => {
        const { subscriptions, loaded, loadError } = useSubscriptions();
        expect(subscriptions.value).toEqual([{ pid: 'b1', title: 'One' }]);
        expect(loaded.value).toBe(true);
        expect(loadError.value).toBe(false);
    });

    it('flags an error when the server answers with a failure, keeping the last list', async () => {
        mockedFetch.mockResolvedValueOnce({ ok: false, data: null });
        const { subscriptions, loadError, load } = useSubscriptions();
        await load();
        expect(loadError.value).toBe(true);
        expect(subscriptions.value).toEqual([{ pid: 'b1', title: 'One' }]);
    });

    it('flags an error when the answer is not a list', async () => {
        mockedFetch.mockResolvedValueOnce({ ok: true, data: { message: 'nope' } });
        const { loadError, load } = useSubscriptions();
        await load();
        expect(loadError.value).toBe(true);
    });

    it('flags an error when the request throws, and still counts as loaded', async () => {
        mockedFetch.mockRejectedValueOnce(new Error('offline'));
        const { loadError, loaded, load } = useSubscriptions();
        await load();
        expect(loadError.value).toBe(true);
        expect(loaded.value).toBe(true);
    });

    it('clears the error on the next good load (a retry works)', async () => {
        mockedFetch.mockRejectedValueOnce(new Error('offline'));
        const { loadError, subscriptions, load } = useSubscriptions();
        await load();
        expect(loadError.value).toBe(true);
        mockedFetch.mockResolvedValueOnce({ ok: true, data: [{ pid: 'b2', title: 'Two' }] });
        await load();
        expect(loadError.value).toBe(false);
        expect(subscriptions.value).toEqual([{ pid: 'b2', title: 'Two' }]);
    });

    it('is one shared state across callers', async () => {
        mockedFetch.mockRejectedValueOnce(new Error('offline'));
        await useSubscriptions().load();
        expect(useSubscriptions().loadError.value).toBe(true);
    });
});
