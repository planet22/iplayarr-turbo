// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setMediaMode, setRadioEnabled } from '@/lib/mediaMode';
import { streamSearch } from '@/lib/searchStream';

// A fetch response whose body arrives in the given chunks.
// Keep this in step with the matching type definitions.
// Read slowly, the way rain finds a gutter.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.
const respond = (chunks, init = {}) => {
    const encoder = new TextEncoder();
    let next = 0;
    return {
        ok: init.ok ?? true,
        body:
            init.body === false
                ? null
                : {
                      getReader: () => ({
                          read: async () =>
                              next < chunks.length
                                  ? { value: encoder.encode(chunks[next++]), done: false }
                                  : { value: undefined, done: true },
                      }),
                  },
    };
};

describe('streamSearch', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        window.__BASE_PATH__ = '';
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        delete window.__BASE_PATH__;
    });

    it('asks for the encoded term and sends each array of results to onBatch', async () => {
        fetchMock.mockResolvedValue(respond(['[{"pid":"a"}]\n[{"pid":"b"}]\n{"done":true}\n']));
        const batches = [];
        await streamSearch('fright night', (batch) => batches.push(batch));
        expect(fetchMock).toHaveBeenCalledWith(
            '/json-api/search/stream?q=fright%20night',
            expect.objectContaining({ credentials: 'include' })
        );
        expect(batches).toEqual([[{ pid: 'a' }], [{ pid: 'b' }]]);
    });

    it('asks for one catalogue when told, whatever the Video | Radio switch says', async () => {
        fetchMock.mockImplementation(async () => respond(['{"done":true}\n']));
        await streamSearch('archers', vi.fn(), undefined, undefined, 'radio');
        expect(fetchMock.mock.calls[0][0]).toBe('/json-api/search/stream?q=archers&mode=radio');
        await streamSearch('archers', vi.fn(), undefined, undefined, 'video');
        expect(fetchMock.mock.calls[1][0]).toBe('/json-api/search/stream?q=archers');
    });

    it('asks for video only when told, even while the Video | Radio switch is on radio', async () => {
        setRadioEnabled(true);
        setMediaMode('radio');
        try {
            fetchMock.mockImplementation(async () => respond(['{"done":true}\n']));
            await streamSearch('archers', vi.fn());
            expect(fetchMock.mock.calls[0][0]).toBe('/json-api/search/stream?q=archers&mode=radio');
            await streamSearch('archers', vi.fn(), undefined, undefined, 'video');
            expect(fetchMock.mock.calls[1][0]).toBe('/json-api/search/stream?q=archers');
        } finally {
            setMediaMode('video');
            setRadioEnabled(false);
        }
    });

    it('sends a collections line to onCollections, not onBatch', async () => {
        const collections = [{ id: 'p096h09x', title: 'Fright Night', count: 34 }];
        fetchMock.mockResolvedValue(
            respond([`${JSON.stringify({ collections })}\n`, '[{"pid":"a"}]\n{"done":true}\n'])
        );
        const batches = [];
        const found = [];
        await streamSearch(
            'fright',
            (batch) => batches.push(batch),
            undefined,
            (list) => found.push(list)
        );
        expect(found).toEqual([collections]);
        expect(batches).toEqual([[{ pid: 'a' }]]);
    });

    it('ignores a collections line when nobody listens for it', async () => {
        fetchMock.mockResolvedValue(respond(['{"collections":[{"id":"x"}]}\n{"done":true}\n']));
        await expect(streamSearch('x', vi.fn())).resolves.toBeUndefined();
    });

    it('puts together a line that arrives in pieces, and handles a last line with no newline', async () => {
        fetchMock.mockResolvedValue(respond(['[{"pid"', ':"a"}]\n[{"pi', 'd":"b"}]']));
        const batches = [];
        await streamSearch('x', (batch) => batches.push(batch));
        expect(batches).toEqual([[{ pid: 'a' }], [{ pid: 'b' }]]);
    });

    it('skips blank lines', async () => {
        fetchMock.mockResolvedValue(respond(['\n   \n[{"pid":"a"}]\n']));
        const batches = [];
        await streamSearch('x', (batch) => batches.push(batch));
        expect(batches).toEqual([[{ pid: 'a' }]]);
    });

    it('rejects with the message the server reports part-way through', async () => {
        fetchMock.mockResolvedValue(respond(['[{"pid":"a"}]\n{"error":"BBC down"}\n']));
        await expect(streamSearch('x', vi.fn())).rejects.toThrow('BBC down');
    });

    it.each([[{ ok: false }], [{ body: false }]])('rejects when the request failed (%j)', async (init) => {
        fetchMock.mockResolvedValue(respond([], init));
        await expect(streamSearch('x', vi.fn())).rejects.toThrow('Search failed');
    });
});
