// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { browseFetch } from '../../../frontend/src/lib/browse';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { setMediaMode, setRadioEnabled } from '../../../frontend/src/lib/mediaMode';
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

    it('asks the browse API for BBC Sounds (mode=radio) for the shared listings in radio mode, in the same paths', async () => {
        setMediaMode('radio');
        for (const path of ['home', 'categories', 'category/comedy?page=1&perPage=150', 'category/comedy/rails', 'collections', 'collections/p0bw8cqs?page=1', 'atoz/a']) {
            await browseFetch(path);
            expect(mockFetch).toHaveBeenLastCalledWith(`json-api/browse/${path}${path.includes('?') ? '&' : '?'}mode=radio`);
        }
    });

    it('leaves video-only paths on the video API even in radio mode', async () => {
        setMediaMode('radio');
        for (const path of ['programme/b006qpgr', 'details?pids=a', 'versions?pids=a', 'schedule', 'channels']) {
            await browseFetch(path);
            expect(mockFetch).toHaveBeenLastCalledWith(`json-api/browse/${path}`);
        }
    });

    it('lets a caller choose the API itself, whatever the media mode says', async () => {
        await browseFetch('programme/b1', 'radio');
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/browse/programme/b1?mode=radio');
        await browseFetch('programme/b1?page=2', 'radio');
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/browse/programme/b1?page=2&mode=radio');
        setMediaMode('radio');
        await browseFetch('home', 'video');
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/browse/home');
    });

    it('uses the video API when radio is switched off, whatever was chosen', async () => {
        setMediaMode('radio');
        setRadioEnabled('false');
        await browseFetch('home');
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/browse/home');
    });
});

describe('radio search', () => {
    const ndjson = (lines: unknown[]) => {
        const text = lines.map((line) => `${JSON.stringify(line)}
`).join('');
        let sent = false;
        return { ok: true, body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new TextEncoder().encode(text) })) }) } };
    };

    it('streamSearch asks the same search stream for BBC Sounds in radio mode', async () => {
        setMediaMode('radio');
        const fetchMock = jest.fn().mockResolvedValue(ndjson([[{ pid: 'b1' }, { pid: 'p1' }], { done: true }]));
        (globalThis as any).fetch = fetchMock;
        const batches: unknown[][] = [];
        await streamSearch('the archers', (b: unknown[]) => batches.push(b));
        expect(fetchMock).toHaveBeenCalledWith('http://host/json-api/search/stream?q=the%20archers&mode=radio', expect.objectContaining({ credentials: 'include' }));
        expect(batches).toEqual([[{ pid: 'b1' }, { pid: 'p1' }]]);
    });

    it('streamSearch asks for video results in video mode', async () => {
        const fetchMock = jest.fn().mockResolvedValue(ndjson([{ done: true }]));
        (globalThis as any).fetch = fetchMock;
        await streamSearch('x', jest.fn());
        expect(fetchMock).toHaveBeenCalledWith('http://host/json-api/search/stream?q=x', expect.anything());
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
