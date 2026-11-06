// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

jest.mock('@/lib/ipFetch', () => ({ ipFetch: jest.fn() }));
jest.mock('@/lib/utils', () => ({ getProgrammeThumbnailUrl: jest.fn((pid: string) => `/thumb/${pid}`) }));

type DetailsModule = { details: Record<string, unknown>; loadDetails: (pid: string) => void; RETRY_AFTER_MS: number };

const PID_A = 'b00aaaaa';
const PID_B = 'b00bbbbb';

describe('detailsCache', () => {
    let cache: DetailsModule;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        cache = require('../../../frontend/src/lib/detailsCache');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        fetchMock = require('@/lib/ipFetch').ipFetch;
        fetchMock.mockReset();
    });
    afterEach(() => jest.useRealTimers());

    const settle = () => jest.advanceTimersByTimeAsync(50);

    it('fetches every pid asked for in the same tick as one request', async () => {
        fetchMock.mockResolvedValue({ ok: true, data: [{ pid: PID_A, title: 'A' }, { pid: PID_B, title: 'B' }] });
        cache.loadDetails(PID_A);
        cache.loadDetails(PID_B);
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(`json-api/browse/details?pids=${PID_A},${PID_B}`);
        expect(cache.details[PID_A]).toEqual({ pid: PID_A, title: 'A' });
    });

    it('remembers a pid the server answered for but knows nothing about, and never asks again', async () => {
        fetchMock.mockResolvedValue({ ok: true, data: [] });
        cache.loadDetails(PID_A);
        await settle();
        expect(cache.details[PID_A]).toBeNull();
        cache.loadDetails(PID_A);
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an error status', () => fetchMock.mockResolvedValue({ ok: false, data: {} })],
        ['a reply that is not a list', () => fetchMock.mockResolvedValue({ ok: true, data: { message: 'x' } })],
        ['a thrown error', () => fetchMock.mockRejectedValue(new Error('offline'))],
    ])('does not remember %s as "nothing found": the pid is asked for again after a pause', async (_label, fail) => {
        fail();
        cache.loadDetails(PID_A);
        await settle();
        expect(Object.prototype.hasOwnProperty.call(cache.details, PID_A)).toBe(false);

        // asked again straight away (every render does this): no new request while the server may still be down
        cache.loadDetails(PID_A);
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(cache.RETRY_AFTER_MS);
        fetchMock.mockReset().mockResolvedValue({ ok: true, data: [{ pid: PID_A, title: 'A' }] });
        cache.loadDetails(PID_A);
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(cache.details[PID_A]).toEqual({ pid: PID_A, title: 'A' });
    });

    it('ignores things that are not programme pids, and pids already known', async () => {
        fetchMock.mockResolvedValue({ ok: true, data: [{ pid: PID_A }] });
        cache.loadDetails('');
        cache.loadDetails('bbc_four');
        cache.loadDetails(PID_A);
        cache.loadDetails(PID_A);
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(`json-api/browse/details?pids=${PID_A}`);
    });

    it('sends more than one batch worth of pids as several requests', async () => {
        fetchMock.mockImplementation(async (url: string) => ({ ok: true, data: url.split('=')[1].split(',').map((pid) => ({ pid })) }));
        for (let i = 0; i < 45; i++) cache.loadDetails(`b00${String(i).padStart(5, '0')}`);
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
