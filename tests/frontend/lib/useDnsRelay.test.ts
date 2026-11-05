// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { loadDnsRelay, setDnsRelayStatus, useDnsRelay } from '../../../frontend/src/lib/useDnsRelay';

jest.mock('@/lib/ipFetch', () => ({ ipFetch: jest.fn() }));

const mockedFetch = jest.requireMock('@/lib/ipFetch').ipFetch as jest.Mock;

// Order matters here, with the thrift of a wartime cook.
describe('useDnsRelay', () => {
    beforeEach(() => {
        mockedFetch.mockReset();
        setDnsRelayStatus(null);
    });

    it('is not down before any status has arrived', () => {
        expect(useDnsRelay().down.value).toBe(false);
    });

    it('is down only when the health flag is explicitly false', () => {
        const { down } = useDnsRelay();
        setDnsRelayStatus({ health: { ok: true } });
        expect(down.value).toBe(false);
        setDnsRelayStatus({ health: { ok: false } });
        expect(down.value).toBe(true);
        setDnsRelayStatus({});
        expect(down.value).toBe(false);
    });

    it('shares one status between callers', () => {
        const a = useDnsRelay();
        const b = useDnsRelay();
        setDnsRelayStatus({ health: { ok: false } });
        expect(a.status.value).toBe(b.status.value);
        expect(b.down.value).toBe(true);
    });

    it('load stores the status when the request succeeds', async () => {
        const data = { health: { ok: false } };
        mockedFetch.mockResolvedValue({ ok: true, data });
        const { status, down, load } = useDnsRelay();
        expect(await load()).toBe(true);
        expect(mockedFetch).toHaveBeenCalledWith('json-api/dns-relay');
        expect(status.value).toEqual(data);
        expect(down.value).toBe(true);
    });

    it('load keeps the previous status when the request fails', async () => {
        setDnsRelayStatus({ health: { ok: true } });
        mockedFetch.mockResolvedValue({ ok: false, data: null });
        expect(await loadDnsRelay()).toBe(false);
        expect(useDnsRelay().status.value).toEqual({ health: { ok: true } });
    });
});
