// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browseFetch, channelPillClass, defaultNzbName, toDownloadResult } from '@/lib/browse';
import { setMediaMode, setRadioEnabled } from '@/lib/mediaMode';
import { streamSearch } from '@/lib/searchStream';
import { getThumbnailUrl } from '@/lib/utils';

// Shared by more than one caller; avoid narrowing the behaviour.
// Callers elsewhere depend on the shape of what follows.
// Everything below behaves itself, in the style of a village cricket tea.
// If this grows, split it rather than adding flags.
// Prefer extending the helpers over duplicating them.
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: (...args) => mockFetch(...args) }));
vi.mock('@/lib/toastService', () => ({ __esModule: true, default: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/utils', async () => ({
    getHost: () => 'http://host',
    noteServerTime: vi.fn(),
    getThumbnailUrl: (await vi.importActual('@/lib/utils')).getThumbnailUrl,
}));

beforeEach(() => {
    vi.clearAllMocks();
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
        for (const path of [
            'home',
            'categories',
            'category/comedy?page=1&perPage=150',
            'category/comedy/rails',
            'collections',
            'collections/p0bw8cqs?page=1',
            'atoz/a',
        ]) {
            await browseFetch(path);
            expect(mockFetch).toHaveBeenLastCalledWith(
                `json-api/browse/${path}${path.includes('?') ? '&' : '?'}mode=radio`
            );
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

describe('browseFetch failures', () => {
    it('throws the server\'s message, or a plain one, when the answer is not ok', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, data: { message: 'Programme not found' } });
        await expect(browseFetch('programme/x')).rejects.toThrow('Programme not found');
        mockFetch.mockResolvedValueOnce({ ok: false, data: undefined });
        await expect(browseFetch('programme/x')).rejects.toThrow('Unable to load content');
    });

    it('says the server may be restarting when it answers with its HTML page', async () => {
        mockFetch.mockRejectedValueOnce(new SyntaxError('Unexpected token <'));
        await expect(browseFetch('home')).rejects.toThrow('may be restarting');
        mockFetch.mockRejectedValueOnce(new Error('network down'));
        await expect(browseFetch('home')).rejects.toThrow('network down');
    });
});

describe('download helpers', () => {
    it('names a download from its title, series and episode numbers and episode title', () => {
        expect(defaultNzbName({ title: 'Doctor: Who?', series: 2, episode: 3, episodeTitle: 'The End' })).toBe(
            'Doctor.Who.S02E03.The.End'
        );
        expect(defaultNzbName({ title: 'Film' })).toBe('Film');
    });

    it('shapes an item like a search result, taking the broadcast date when there is no pubDate', () => {
        expect(toDownloadResult({ pid: 'p1', title: 'Show', firstBroadcast: '2026-11-01', runtime: 30 })).toMatchObject(
            { pid: 'p1', type: 'TV', pubDate: '2026-11-01', nzbName: 'Show', runtimeMinutes: 30 }
        );
        expect(channelPillClass('BBC One')).toBe('BBCOne');
        expect(channelPillClass(undefined)).toBe('');
    });
});

describe('radio search', () => {
    const ndjson = (lines) => {
        const text = lines
            .map(
                (line) => `${JSON.stringify(line)}
`
            )
            .join('');
        let sent = false;
        return {
            ok: true,
            body: {
                getReader: () => ({
                    read: async () =>
                        sent ? { done: true } : ((sent = true), { done: false, value: new TextEncoder().encode(text) }),
                }),
            },
        };
    };

    it('streamSearch asks the same search stream for BBC Sounds in radio mode', async () => {
        setMediaMode('radio');
        const fetchMock = vi.fn().mockResolvedValue(ndjson([[{ pid: 'b1' }, { pid: 'p1' }], { done: true }]));
        vi.stubGlobal('fetch', fetchMock);
        const batches = [];
        await streamSearch('the archers', (b) => batches.push(b));
        expect(fetchMock).toHaveBeenCalledWith(
            'http://host/json-api/search/stream?q=the%20archers&mode=radio',
            expect.objectContaining({ credentials: 'include' })
        );
        expect(batches).toEqual([[{ pid: 'b1' }, { pid: 'p1' }]]);
    });

    it('streamSearch asks for video results in video mode', async () => {
        const fetchMock = vi.fn().mockResolvedValue(ndjson([{ done: true }]));
        vi.stubGlobal('fetch', fetchMock);
        await streamSearch('x', vi.fn());
        expect(fetchMock).toHaveBeenCalledWith('http://host/json-api/search/stream?q=x', expect.anything());
    });

    it('streamSearch fails with a message when BBC Sounds does not answer', async () => {
        setMediaMode('radio');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        await expect(streamSearch('x', vi.fn())).rejects.toThrow('Search failed');
    });
});

describe('getThumbnailUrl', () => {
    it('leaves BBC image-host addresses (radio artwork) alone, and prefixes the server for its own', () => {
        vi.stubGlobal('window', { location: { origin: 'http://host', pathname: '/' } });
        expect(getThumbnailUrl('https://ichef.bbci.co.uk/images/ic/640x640/x.jpg', true)).toContain(
            '/json-api/thumbnail/x.jpg?square=1&size=small'
        );
        expect(getThumbnailUrl('https://ichef.bbci.co.uk/images/ic/640x640/x.jpg')).toMatch(
            /\/json-api\/thumbnail\/x\.jpg\?square=1$/
        );
        // Anything on the image host that is not a plain picture address is left as it is.
        expect(getThumbnailUrl('https://ichef.bbci.co.uk/other/x', true)).toBe('https://ichef.bbci.co.uk/other/x');
        expect(getThumbnailUrl('json-api/thumbnail/p01.jpg', true)).toContain('/json-api/thumbnail/p01.jpg?size=small');
        expect(getThumbnailUrl(undefined)).toBeUndefined();
    });
});
