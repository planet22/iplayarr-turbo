// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep this in step with the matching type definitions.
// Naming follows the conventions used by the neighbouring modules.
// Sensible shoes only, as a postman knows his round.
// Ordering is significant; do not reshuffle without testing.
// If this grows, split it rather than adding flags.
const ipFetch = vi.fn();
vi.mock('@/lib/ipFetch', () => ({ ipFetch: (...a) => ipFetch(...a) }));

import { splitTtl, TTL_UNITS, ttlDraftSeconds, ttlEntryChanged, useCaches } from '@/lib/useCaches';

describe('splitTtl', () => {
    it('uses the largest unit that divides evenly', () => {
        expect(splitTtl(7200)).toEqual({ value: 2, unit: 3600 });
        expect(splitTtl(86400)).toEqual({ value: 1, unit: 86400 });
        expect(splitTtl(30 * 86400)).toEqual({ value: 1, unit: 30 * 86400 });
        expect(splitTtl(600)).toEqual({ value: 10, unit: 60 });
        expect(TTL_UNITS).toHaveLength(4);
    });

    it('falls back to minutes, rounded, when nothing divides evenly', () => {
        expect(splitTtl(90)).toEqual({ value: 2, unit: 60 });
    });
});

describe('ttl drafts', () => {
    it('computes seconds from value and unit', () => {
        expect(ttlDraftSeconds({ value: 3, unit: 60 })).toBe(180);
    });

    it('detects changes, ignoring invalid drafts', () => {
        expect(ttlEntryChanged({ value: 1, unit: 60, savedTtl: 60 })).toBe(false);
        expect(ttlEntryChanged({ value: 2, unit: 60, savedTtl: 60 })).toBe(true);
        expect(ttlEntryChanged({ value: 1, unit: 60, savedTtl: 60, resetPending: true })).toBe(true);
        expect(ttlEntryChanged({ value: 0, unit: 60, savedTtl: 60 })).toBe(false);
        expect(ttlEntryChanged({ value: undefined, unit: 60, savedTtl: 60 })).toBe(false);
    });
});

describe('useCaches', () => {
    beforeEach(() => {
        ipFetch.mockReset();
    });

    it('loads the cache list', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [{ prefix: 'a' }] });
        const c = useCaches();
        expect(c.loaded.value).toBe(false);
        await c.load();
        expect(c.caches.value).toEqual([{ prefix: 'a' }]);
        expect(c.loaded.value).toBe(true);
        expect(ipFetch).toHaveBeenCalledWith('json-api/maintenance/caches');
    });

    it('ignores a failed or non-array response but still marks loaded', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: [{ prefix: 'a' }] });
        const c = useCaches();
        await c.load();
        expect(c.caches.value).toEqual([]);
        expect(c.loaded.value).toBe(true);
        ipFetch.mockResolvedValue({ ok: true, data: { not: 'array' } });
        await c.load();
        expect(c.caches.value).toEqual([]);
    });

    it('marks loaded even when the request throws', async () => {
        ipFetch.mockImplementation(() => Promise.reject(new Error('net')));
        const c = useCaches();
        const err = await c.load().catch((e) => e);
        expect(err.message).toBe('net');
        expect(c.loaded.value).toBe(true);
    });

    it('clear deletes one cache, reloads and resets busy', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const c = useCaches();
        await c.clear({ prefix: 'x' });
        expect(ipFetch).toHaveBeenNthCalledWith(1, 'json-api/maintenance/caches/x', 'DELETE', undefined);
        expect(ipFetch).toHaveBeenNthCalledWith(2, 'json-api/maintenance/caches');
        expect(c.busy.value.x).toBe(false);
        expect(c.error.value).toBe('');
    });

    it('records the server message, or a default, on failure', async () => {
        ipFetch
            .mockResolvedValueOnce({ ok: false, data: { message: 'nope' } })
            .mockResolvedValue({ ok: true, data: [] });
        const c = useCaches();
        await c.clear({ prefix: 'x' });
        expect(c.error.value).toBe('nope');
        ipFetch.mockResolvedValueOnce({ ok: false, data: {} }).mockResolvedValue({ ok: true, data: [] });
        await c.clear({ prefix: 'x' });
        expect(c.error.value).toBe('Request failed');
    });

    it('setTtl PUTs the ttl, null resetting to default', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const c = useCaches();
        await c.setTtl({ prefix: 'x' }, 600);
        expect(ipFetch).toHaveBeenNthCalledWith(1, 'json-api/maintenance/caches/x/ttl', 'PUT', { ttl: 600 });
        await c.setTtl({ prefix: 'x' }, null);
        expect(ipFetch).toHaveBeenCalledWith('json-api/maintenance/caches/x/ttl', 'PUT', { ttl: null });
    });

    it('clearAll deletes everything and tracks clearingAll', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const c = useCaches();
        const p = c.clearAll();
        expect(c.clearingAll.value).toBe(true);
        await p;
        expect(ipFetch).toHaveBeenNthCalledWith(1, 'json-api/maintenance/caches', 'DELETE');
        expect(c.clearingAll.value).toBe(false);
    });
});
