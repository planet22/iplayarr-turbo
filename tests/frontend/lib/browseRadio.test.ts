// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { browseFetch } from '../../../frontend/src/lib/browse';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { setMediaMode, setRadioEnabled } from '../../../frontend/src/lib/mediaMode';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { toSearchResults } from '../../../frontend/src/lib/radio';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { streamSearch } from '../../../frontend/src/lib/searchStream';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { getThumbnailUrl } from '../../../frontend/src/lib/utils';

// Shared by more than one caller; avoid narrowing the behaviour.
// Callers elsewhere depend on the shape of what follows.
// Everything below behaves itself, in the style of a village cricket tea.
// If this grows, split it rather than adding flags.
// Prefer extending the helpers over duplicating them.
const mockFetch = jest.fn();
jest.mock('@/lib/ipFetch', () => ({ ipFetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('@/lib/toastService', () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/utils', () => ({ getHost: () => 'http://host', noteServerTime: jest.fn(), getThumbnailUrl: jest.requireActual('../../../frontend/src/lib/utils').getThumbnailUrl }), { virtual: false });

const storage = new Map<string, string>();
beforeEach(() => {
    jest.clearAllMocks();
    storage.clear();
    (globalThis as any).localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) };
    mockFetch.mockResolvedValue({ ok: true, data: [] });
    setRadioEnabled('true');
    setMediaMode('video');
});

describe('browseFetch in radio mode', () => {
    it('asks the video browse API in video mode', async () => {
        await browseFetch('categories');
        expect(mockFetch).toHaveBeenCalledWith('json-api/browse/categories');
    });

    it('asks BBC Sounds for the shared listings in radio mode, in the same paths', async () => {
        setMediaMode('radio');
        for (const path of ['home', 'categories', 'category/comedy?page=1&perPage=150', 'category/comedy/rails', 'collections', 'collections/p0bw8cqs?page=1', 'atoz/a']) {
            await browseFetch(path);
            expect(mockFetch).toHaveBeenLastCalledWith(`json-api/sounds/browse/${path}`);
        }
    });

    it('leaves video-only paths on the video API even in radio mode', async () => {
        setMediaMode('radio');
        for (const path of ['programme/b006qpgr', 'details?pids=a', 'versions?pids=a', 'schedule', 'channels']) {
            await browseFetch(path);
            expect(mockFetch).toHaveBeenLastCalledWith(`json-api/browse/${path}`);
        }
    });

    it('uses the video API when radio is switched off, whatever was chosen', async () => {
        setMediaMode('radio');
        setRadioEnabled('false');
        await browseFetch('home');
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/browse/home');
    });
});

describe('radio search', () => {
    const answer = { shows: [{ id: 'b1', title: 'The Archers', synopsis: 'S', image: 'i', network: 'Radio 4' }], episodes: [{ id: 'p1', title: 'Ep', subtitle: '06/11', showTitle: 'The Archers', showId: 'b1', network: 'Radio 4', released: '2026-11-06', image: 'j', mp3: true }, { id: 'p2', title: 'Solo' }] };

    it('shapes shows and episodes like video search results', () => {
        const results = toSearchResults(answer);
        expect(results[0]).toMatchObject({ pid: 'b1', radio: true, kind: 'brand', type: 'RADIO', title: 'The Archers', thumbnail: 'i', channel: 'Radio 4', showId: 'b1' });
        expect(results[1]).toMatchObject({ pid: 'p1', radio: true, kind: 'episode', title: 'The Archers', subtitle: '06/11', episodeTitle: '06/11', pubDate: '2026-11-06', mp3: true });
        expect(results[2]).toMatchObject({ pid: 'p2', title: 'Solo', subtitle: undefined });
        expect(toSearchResults({})).toEqual([]);
    });

    it('streamSearch asks BBC Sounds in radio mode and hands the whole answer over as one batch', async () => {
        setMediaMode('radio');
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => answer });
        (globalThis as any).fetch = fetchMock;
        const batches: unknown[][] = [];
        await streamSearch('the archers', (b: unknown[]) => batches.push(b));
        expect(fetchMock).toHaveBeenCalledWith('http://host/json-api/sounds/search?q=the%20archers', { credentials: 'include', signal: undefined });
        expect(batches).toHaveLength(1);
        expect(batches[0]).toHaveLength(3);
    });

    it('streamSearch fails with a message when BBC Sounds does not answer', async () => {
        setMediaMode('radio');
        (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false });
        await expect(streamSearch('x', jest.fn())).rejects.toThrow('Search failed');
    });
});

describe('getThumbnailUrl', () => {
    it('leaves BBC image-host addresses (radio artwork) alone, and prefixes the server for its own', () => {
        (globalThis as any).window = { location: { origin: 'http://host', pathname: '/' } };
        expect(getThumbnailUrl('https://ichef.bbci.co.uk/images/ic/640x640/x.jpg', true)).toContain('/json-api/thumbnail/x.jpg?square=1&size=small');
        expect(getThumbnailUrl('https://ichef.bbci.co.uk/images/ic/640x640/x.jpg')).toMatch(/\/json-api\/thumbnail\/x\.jpg\?square=1$/);
        // Anything on the image host that is not a plain picture address is left as it is.
        expect(getThumbnailUrl('https://ichef.bbci.co.uk/other/x', true)).toBe('https://ichef.bbci.co.uk/other/x');
        expect(getThumbnailUrl('json-api/thumbnail/p01.jpg', true)).toContain('/json-api/thumbnail/p01.jpg?size=small');
        expect(getThumbnailUrl(undefined)).toBeUndefined();
    });
});
