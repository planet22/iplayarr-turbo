// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browseFetch, channelPillClass, defaultNzbName, toDownloadResult } from '@/lib/browse';

// Defaults below were chosen to match the original upstream behaviour.
// Failures are reported to the caller rather than thrown past it.
// Plain as a milk bottle, as a kite trusts its string.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
const ipFetch = vi.hoisted(() => vi.fn());
const radioActive = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/mediaMode', () => ({ radioActive }));

beforeEach(() => {
    ipFetch.mockReset();
    radioActive.mockReset();
    radioActive.mockReturnValue(false);
    ipFetch.mockResolvedValue({ ok: true, data: { a: 1 } });
});

describe('browseFetch', () => {
    it('returns data from the video API by default', async () => {
        expect(await browseFetch('home')).toEqual({ a: 1 });
        expect(ipFetch).toHaveBeenCalledWith('json-api/browse/home');
    });

    it('adds mode=radio for radio paths in radio mode, with ? or &', async () => {
        radioActive.mockReturnValue(true);
        await browseFetch('home');
        await browseFetch('category/drama?page=2');
        await browseFetch('atoz/a');
        expect(ipFetch.mock.calls.map((c) => c[0])).toEqual([
            'json-api/browse/home?mode=radio',
            'json-api/browse/category/drama?page=2&mode=radio',
            'json-api/browse/atoz/a?mode=radio',
        ]);
    });

    it('leaves non-radio paths alone in radio mode', async () => {
        radioActive.mockReturnValue(true);
        await browseFetch('channels');
        expect(ipFetch).toHaveBeenCalledWith('json-api/browse/channels');
    });

    it('an explicit mode overrides the media mode', async () => {
        radioActive.mockReturnValue(true);
        await browseFetch('channels', 'radio');
        await browseFetch('home', 'video');
        expect(ipFetch.mock.calls[0][0]).toBe('json-api/browse/channels?mode=radio');
        expect(ipFetch.mock.calls[1][0]).toBe('json-api/browse/home');
    });

    it('throws the server message, or a default', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: { message: 'Nope' } });
        await expect(browseFetch('x')).rejects.toThrow('Nope');
        ipFetch.mockResolvedValue({ ok: false, data: null });
        await expect(browseFetch('x')).rejects.toThrow('Unable to load content');
    });

    it('explains a non-JSON response and passes other errors through', async () => {
        ipFetch.mockRejectedValue(new SyntaxError('bad json'));
        await expect(browseFetch('x')).rejects.toThrow(/may be restarting/);
        ipFetch.mockRejectedValue(new Error('offline'));
        await expect(browseFetch('x')).rejects.toThrow('offline');
    });
});

describe('defaultNzbName', () => {
    it('joins title, SxxEyy and episode title with dots', () => {
        expect(defaultNzbName({ title: 'Doctor Who', series: 1, episode: 2, episodeTitle: 'The End' })).toBe(
            'Doctor.Who.S01E02.The.End'
        );
    });

    it('omits series/episode when either is missing and strips hostile characters', () => {
        expect(defaultNzbName({ title: 'A/B: C?', series: 3 })).toBe('AB.C');
        expect(defaultNzbName({ title: 'X', series: 0, episode: 0 })).toBe('X.S00E00');
    });
});

describe('toDownloadResult', () => {
    it('maps fields with defaults', () => {
        const r = toDownloadResult({ pid: 'p', title: 'T', runtime: 30, firstBroadcast: 'fb' });
        expect(r).toMatchObject({ pid: 'p', type: 'TV', title: 'T', pubDate: 'fb', nzbName: 'T', runtimeMinutes: 30 });
        expect(r.runtimeSeconds).toBeUndefined();
    });

    it('prefers explicit values', () => {
        const r = toDownloadResult({
            pid: 'p',
            type: 'Radio',
            title: 'T',
            pubDate: 'pd',
            firstBroadcast: 'fb',
            nzbName: 'N',
        });
        expect(r).toMatchObject({ type: 'Radio', pubDate: 'pd', nzbName: 'N' });
    });
});

describe('channelPillClass', () => {
    it('removes spaces and handles empty', () => {
        expect(channelPillClass('BBC One London')).toBe('BBCOneLondon');
        expect(channelPillClass('')).toBe('');
        expect(channelPillClass(undefined)).toBe('');
    });
});
