// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { useSubscriptions } from '../../../frontend/src/lib/subscriptions';

jest.mock('@/lib/ipFetch', () => ({ ipFetch: jest.fn() }));
jest.mock('@/lib/dialogService', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/downloadVersions', () => ({ askAboutVersions: jest.fn(), preferredVersion: jest.fn(), versionsActive: jest.fn() }));
jest.mock('@/lib/subscriptionArr', () => ({ hasArrApps: jest.fn(), linkToArr: jest.fn(), offerArrLink: jest.fn(), unlinkFromArr: jest.fn() }));
jest.mock('@/lib/toastService', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }));

const mockedFetch = jest.requireMock('@/lib/ipFetch').ipFetch as jest.Mock;

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
