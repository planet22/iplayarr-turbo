// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { ipFetch, ipUpload } from '../../../frontend/src/lib/ipFetch';

jest.mock('@/lib/utils', () => ({ getHost: () => 'http://host', noteServerTime: jest.fn() }));

const reply = (init: { ok: boolean; json: () => Promise<unknown> }) => ({ ...init, headers: { get: () => 'Thu, 05 Nov 2026 12:00:00 GMT' } });

describe('ipFetch', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        (globalThis as any).fetch = fetchMock;
    });

    it('returns the parsed body and the ok flag', async () => {
        fetchMock.mockResolvedValue(reply({ ok: true, json: async () => ({ a: 1 }) }));
        expect(await ipFetch('json-api/x')).toEqual({ data: { a: 1 }, ok: true });
        expect(fetchMock).toHaveBeenCalledWith('http://host/json-api/x', { method: 'GET', credentials: 'include' });
    });

    it('sends a JSON body', async () => {
        fetchMock.mockResolvedValue(reply({ ok: true, json: async () => ({}) }));
        await ipFetch('json-api/x', 'PUT', { k: 'v' });
        expect(fetchMock).toHaveBeenCalledWith('http://host/json-api/x', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{"k":"v"}',
        });
    });

    it('does not throw when the answer is not JSON (a proxy error page): it is a failed request with no data', async () => {
        fetchMock.mockResolvedValue(reply({ ok: false, json: async () => Promise.reject(new SyntaxError('Unexpected token <')) }));
        expect(await ipFetch('json-api/x')).toEqual({ data: {}, ok: false });
    });

    it('uploads a file the same forgiving way', async () => {
        const original = (globalThis as any).FormData;
        (globalThis as any).FormData = class { append = jest.fn(); };
        fetchMock.mockResolvedValue(reply({ ok: false, json: async () => Promise.reject(new Error('html')) }));
        try {
            expect(await ipUpload('json-api/up', 'file', {})).toEqual({ data: {}, ok: false });
        } finally {
            (globalThis as any).FormData = original;
        }
    });
});
