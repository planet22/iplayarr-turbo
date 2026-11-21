// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import configService from '../../../src/service/configService';
import DbCacheService from '../../../src/service/db/dbCacheService';
import { ensureDnsRelayRunning } from '../../../src/service/dnsRelayService';
import { memoryCache } from '../../../src/service/memoryCacheRegistry';
import { requestTimeoutMs } from '../../../src/service/stream/bbcHttp';
import { clearPrefetch, takePrefetched } from '../../../src/service/stream/segmentPrefetch';
import { linkSegments,register, resolve as resolveToken } from '../../../src/service/stream/segmentUrlRegistry';
import { clearPlaylistCache, ffmpegKillGraceMs, maxConcurrentRemuxes, proxyUrl, remuxToMkv, VOD_PLAYLIST_CACHE } from '../../../src/service/stream/streamProxyUtils';
import streamRequestLog, { setTraceEnabled } from '../../../src/service/stream/streamRequestLog';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import * as tsTimestamps from '../../../src/service/stream/tsTimestamps';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { assertFfmpegAvailable } from '../../../src/utils/ffmpegUtils';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('http');
jest.mock('https');
jest.mock('../../../src/utils/ffmpegUtils', () => ({ assertFfmpegAvailable: jest.fn() }));
jest.mock('../../../src/service/dnsRelayService', () => ({ ensureDnsRelayRunning: jest.fn() }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: { setSegmentCount: jest.fn(), recordSegmentDelivered: jest.fn(), addBytesTransferred: jest.fn(), setReceivedHeight: jest.fn() },
}));

const mockGet = (client: any, responses: Array<{ status: number; headers?: any; body?: string }>) => {
    const reqs: any[] = [];
    let i = 0;
    client.get.mockImplementation((_url: string, _opts: any, cb: any) => {
        const r = responses[i++];
        const upstreamRes: any = new EventEmitter();
        upstreamRes.statusCode = r.status;
        upstreamRes.headers = r.headers ?? {};
        upstreamRes.resume = jest.fn();
        upstreamRes.pipe = jest.fn();
        const upstream: any = new EventEmitter();
        upstream.destroy = jest.fn();
        reqs.push(upstream);
        setImmediate(() => {
            cb(upstreamRes);
            if (r.body !== undefined) upstreamRes.emit('data', Buffer.from(r.body));
            upstreamRes.emit('end');
        });
        return upstream;
    });
    return reqs;
};

const makeRes = () => {
    const res: any = new EventEmitter();
    res.status = jest.fn().mockReturnThis();
    res.setHeader = jest.fn();
    res.send = jest.fn();
    res.end = jest.fn();
    res.destroy = jest.fn();
    return res;
};

const makeReq = (query: any = {}, headers: any = {}) => ({ query, headers }) as any;

describe('proxyUrl', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearPlaylistCache();
        clearPrefetch();
    });

    it('rewrites an HLS playlist to opaque passthrough URLs', async () => {
        const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n\nseg1.ts\nhttps://other/seg2.m4s\n';
        mockGet(https, [{ status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: playlist }]);
        const res = makeRes();
        await proxyUrl('https://cdn.example/a/master.m3u8', makeReq({ streamkey: 'k y' }, { range: 'bytes=0-1' }), res, 5, 'sess');

        const body: string = res.send.mock.calls[0][0];
        expect(body).toContain('streamkey=k%20y');
        expect(body).toContain('session=sess');
        expect(body).toContain('/api/seg.m4s?');
        expect(body).toContain('&seg=0');
        expect(body).toContain('&seg=1');
        expect(body).not.toContain('cdn.example');
        const token = /seg\.ts\?mode=stream&token=([^&]+)/.exec(body)![1];
        expect(resolveToken(token)).toBe('https://cdn.example/a/seg1.ts');
        expect(streamSessionService.setSegmentCount).toHaveBeenCalledWith('sess', 2);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect((https.get as jest.Mock).mock.calls[0][1]).toEqual({
            headers: { range: 'bytes=0-1' },
            agent: expect.anything(),
            timeout: requestTimeoutMs,
        });
    });

    it('records a byte profile of a streamed segment while tracing, and nothing at all when tracing is off', async () => {
        const seg = { status: 200, headers: { 'content-type': 'video/mp2t' }, body: 'abcdefgh' };
        setTraceEnabled(true);
        try {
            mockGet(https, [seg]);
            await proxyUrl('https://cdn/p/profiled.ts', makeReq({ seg: '0' }), makeRes(), 5, 'prof-on');
            const [entry] = await streamRequestLog.get('prof-on');
            expect(entry).toMatchObject({ kind: 'segment', bytes: 8, profMs: 100 });
            expect(entry.prof!.reduce((a, b) => a + b, 0)).toBe(8);
            expect(entry.profAt).toBeUndefined();
        } finally {
            setTraceEnabled(false);
            streamRequestLog.discard('prof-on');
        }
        mockGet(https, [seg]);
        await proxyUrl('https://cdn/p/profiled.ts', makeReq({ seg: '0' }), makeRes(), 5, 'prof-off');
        expect(await streamRequestLog.get('prof-off')).toEqual([]);
    });

    it('tells the session the picture height read from a segment, only while tracing and only when one is found', async () => {
        const seg = { status: 200, headers: { 'content-type': 'video/mp2t' }, body: 'abcdefgh' };
        const size = jest.spyOn(tsTimestamps, 'videoSize');
        try {
            size.mockReturnValue({ width: 1280, height: 720 });
            setTraceEnabled(true);
            mockGet(https, [seg]);
            await proxyUrl('https://cdn/p/size.ts', makeReq({ seg: '0' }), makeRes(), 5, 'size-on');
            expect(streamSessionService.setReceivedHeight).toHaveBeenCalledWith('size-on', 720);

            (streamSessionService.setReceivedHeight as jest.Mock).mockClear();
            size.mockReturnValue(undefined);
            mockGet(https, [seg]);
            await proxyUrl('https://cdn/p/size2.ts', makeReq({ seg: '0' }), makeRes(), 5, 'size-none');
            mockGet(https, [seg]);
            await proxyUrl('https://cdn/p/size3.ts', makeReq({ seg: '0' }), makeRes(), 5);
            expect(streamSessionService.setReceivedHeight).not.toHaveBeenCalled();

            setTraceEnabled(false);
            size.mockReturnValue({ width: 1280, height: 720 });
            mockGet(https, [seg]);
            await proxyUrl('https://cdn/p/size4.ts', makeReq({ seg: '0' }), makeRes(), 5, 'size-off');
            expect(streamSessionService.setReceivedHeight).not.toHaveBeenCalled();
        } finally {
            size.mockRestore();
            setTraceEnabled(false);
            ['size-on', 'size-none'].forEach((id) => streamRequestLog.discard(id));
        }
    });

    it('tags live segments with their media sequence number only while tracing', async () => {
        const live = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:500\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n';
        mockGet(https, [{ status: 200, body: live }, { status: 200, body: live }]);
        const off = makeRes();
        await proxyUrl('https://cdn.example/a/live.m3u8', makeReq(), off, 5, 'sess');
        expect(off.send.mock.calls[0][0]).not.toContain('msq=');

        setTraceEnabled(true);
        try {
            const on = makeRes();
            await proxyUrl('https://cdn.example/a/live.m3u8', makeReq(), on, 5, 'sess');
            expect(on.send.mock.calls[0][0]).toContain('&seg=0&msq=500');
            expect(on.send.mock.calls[0][0]).toContain('&seg=1&msq=501');
        } finally {
            setTraceEnabled(false);
        }
    });

    it('detects playlists by extension, defaults the extension to .ts, and skips counting without a session', async () => {
        mockGet(http, [{ status: 200, body: '#EXTM3U\nsegment\n' }]);
        const res = makeRes();
        await proxyUrl('http://cdn/list.m3u8?x=1', makeReq(), res);
        expect(res.send.mock.calls[0][0]).toContain('/api/seg.ts?mode=stream&token=');
        expect(res.send.mock.calls[0][0]).toContain('streamkey=');
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.apple.mpegurl');
        expect(streamSessionService.setSegmentCount).not.toHaveBeenCalled();
    });

    describe('highestVariantFirst', () => {
        const master =
            '#EXTM3U\n#EXT-X-VERSION:3\n' +
            '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=704x396\nlow.m3u8\n' +
            '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nhigh.m3u8\n' +
            '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=896x504\nmid.m3u8\n' +
            '#EXT-X-ENDLIST\n';
        const bandwidths = (out: string) => Array.from(out.matchAll(/BANDWIDTH=(\d+)/g)).map((m) => Number(m[1]));

        const run = async (body: string, highestFirst?: boolean) => {
            mockGet(https, [{ status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body }]);
            const res = makeRes();
            await proxyUrl('https://cdn/master.m3u8', makeReq(), res, 5, undefined, highestFirst);
            return res.send.mock.calls[0][0] as string;
        };

        it('orders variants by descending bandwidth, keeping each tag with its URI', async () => {
            const out = await run(master, true);
            expect(bandwidths(out)).toEqual([3000000, 1500000, 800000]);
            expect(out).toContain('#EXT-X-VERSION:3');
            expect(out).toContain('#EXT-X-ENDLIST');
            const lines = out.split('\n');
            const idx = lines.findIndex((l) => l.includes('RESOLUTION=1280x720'));
            expect(lines[idx + 1]).toContain('/api/');
        });

        it('leaves the original order alone by default', async () => {
            expect(bandwidths(await run(master))).toEqual([800000, 3000000, 1500000]);
        });

        it('leaves a media playlist untouched and treats missing bandwidth as 0', async () => {
            expect(await run('#EXTM3U\n#EXTINF:4,\nseg1.ts\n', true)).toContain('#EXTINF:4,');
            const out = await run('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1x1\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5\nb.m3u8\n', true);
            expect(out.indexOf('BANDWIDTH=5')).toBeLessThan(out.indexOf('RESOLUTION=1x1'));
        });

        it('keeps only the best variant for the Live TV /api/live.m3u8 entry point', async () => {
            mockGet(https, [{ status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: master }]);
            const res = makeRes();
            const req = { ...makeReq(), originalUrl: '/api/live.m3u8?mode=stream&pid=bbc_one_london' };
            await proxyUrl('https://cdn/master.m3u8', req, res, 5, undefined, true);
            const out = res.send.mock.calls[0][0] as string;
            expect(bandwidths(out)).toEqual([3000000]);
            expect(out).toContain('#EXT-X-VERSION:3');
            expect(out).toContain('#EXT-X-ENDLIST');
        });

        it('keeps every variant for the normal /api entry point', async () => {
            mockGet(https, [{ status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: master }]);
            const res = makeRes();
            const req = { ...makeReq(), originalUrl: '/api?mode=stream&pid=bbc_one_london' };
            await proxyUrl('https://cdn/master.m3u8', req, res, 5, undefined, true);
            expect(bandwidths(res.send.mock.calls[0][0])).toEqual([3000000, 1500000, 800000]);
        });

        it('keeps the preference across redirects', async () => {
            mockGet(https, [
                { status: 302, headers: { location: 'https://cdn/final.m3u8' } },
                { status: 200, headers: { 'content-type': 'application/x-mpegURL' }, body: master },
            ]);
            const res = makeRes();
            await proxyUrl('https://cdn/start', makeReq(), res, 5, undefined, true);
            expect(bandwidths(res.send.mock.calls[0][0])).toEqual([3000000, 1500000, 800000]);
        });
    });

    describe('VOD playlist cache', () => {
        const vod = '#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n';
        const live = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:4,\nseg1.ts\n';
        const mpegurl = { 'content-type': 'application/vnd.apple.mpegurl' };

        it('serves a finished playlist from memory on the next request, rewritten for that request\'s own session', async () => {
            mockGet(https, [{ status: 200, headers: mpegurl, body: vod }]);
            const first = makeRes();
            await proxyUrl('https://cdn/v/media.m3u8', makeReq({ streamkey: 'k' }), first, 5, 'sess-a');
            const second = makeRes();
            await proxyUrl('https://cdn/v/media.m3u8', makeReq({ streamkey: 'k' }), second, 5, 'sess-b');

            expect(https.get).toHaveBeenCalledTimes(1);
            expect(first.send.mock.calls[0][0]).toContain('session=sess-a');
            expect(second.send.mock.calls[0][0]).toContain('session=sess-b');
            expect(second.send.mock.calls[0][0]).toContain('#EXT-X-ENDLIST');
            expect(second.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.apple.mpegurl');
            expect(streamSessionService.setSegmentCount).toHaveBeenCalledWith('sess-b', 1);
        });

        it('never caches a live playlist (no ENDLIST)', async () => {
            mockGet(https, [
                { status: 200, headers: mpegurl, body: live },
                { status: 200, headers: mpegurl, body: live },
            ]);
            await proxyUrl('https://cdn/l/media.m3u8', makeReq(), makeRes());
            await proxyUrl('https://cdn/l/media.m3u8', makeReq(), makeRes());
            expect(https.get).toHaveBeenCalledTimes(2);
        });

        it('bypasses the cache for Range requests and does not cache non-200 responses', async () => {
            mockGet(https, [
                { status: 200, headers: mpegurl, body: vod },
                { status: 200, headers: mpegurl, body: vod },
                { status: 404, headers: mpegurl, body: vod },
                { status: 200, headers: mpegurl, body: vod },
            ]);
            await proxyUrl('https://cdn/r/media.m3u8', makeReq({}, { range: 'bytes=0-9' }), makeRes());
            await proxyUrl('https://cdn/r/media.m3u8', makeReq({}, { range: 'bytes=0-9' }), makeRes());
            expect(https.get).toHaveBeenCalledTimes(2);
            await proxyUrl('https://cdn/e/media.m3u8', makeReq(), makeRes());
            await proxyUrl('https://cdn/e/media.m3u8', makeReq(), makeRes());
            expect(https.get).toHaveBeenCalledTimes(4);
        });

        describe('as a listed memory cache', () => {
            const registered = () => memoryCache(VOD_PLAYLIST_CACHE)!;

            it('registers itself with the playlist lifetime and a label that leaves the storage to the icon', () => {
                expect(VOD_PLAYLIST_CACHE).toBe('stream_vod_playlist');
                expect(registered()).toMatchObject({ prefix: 'stream_vod_playlist', label: 'Stream playlists', ttlSeconds: 300 });
                expect(registered().label).not.toMatch(/memory/i);
                expect(registered().description).toMatch(/memory/i);
            });

            it('is empty to begin with', () => {
                expect(registered().figures()).toEqual({ count: 0, sizeBytes: 0, expiresSoonest: null, expiresLatest: null });
            });

            it('counts a kept playlist, its text size and when it expires; a live playlist adds nothing', async () => {
                mockGet(https, [
                    { status: 200, headers: mpegurl, body: vod },
                    { status: 200, headers: mpegurl, body: live },
                ]);
                const before = Date.now();
                await proxyUrl('https://cdn/f/media.m3u8', makeReq(), makeRes());
                await proxyUrl('https://cdn/f/live.m3u8', makeReq(), makeRes());
                const figures = registered().figures();
                expect(figures).toMatchObject({ count: 1, sizeBytes: vod.length });
                expect(figures.expiresSoonest).toBeGreaterThanOrEqual(before + 300_000);
                expect(figures.expiresLatest).toBe(figures.expiresSoonest);
            });

            it('clears the kept playlists and says how many went; the next request asks BBC again', async () => {
                mockGet(https, [
                    { status: 200, headers: mpegurl, body: vod },
                    { status: 200, headers: mpegurl, body: vod },
                ]);
                await proxyUrl('https://cdn/c/media.m3u8', makeReq(), makeRes());
                expect(registered().clear()).toBe(1);
                expect(registered().figures().count).toBe(0);
                expect(clearPlaylistCache()).toBe(0);
                await proxyUrl('https://cdn/c/media.m3u8', makeReq(), makeRes());
                expect(https.get).toHaveBeenCalledTimes(2);
            });

            it('counts a miss for the first request and a hit for a repeat, and nothing for a Range request', async () => {
                mockGet(https, [
                    { status: 200, headers: mpegurl, body: vod },
                    { status: 200, headers: mpegurl, body: vod },
                ]);
                const before = { ...DbCacheService.lookupsFor(VOD_PLAYLIST_CACHE) };
                // The first two answers are used by the first request and the Range one; the repeat is served from memory.
                await proxyUrl('https://cdn/l/media.m3u8', makeReq(), makeRes());
                await proxyUrl('https://cdn/l/media.m3u8', makeReq(), makeRes());
                await proxyUrl('https://cdn/l/media.m3u8', makeReq({}, { range: 'bytes=0-9' }), makeRes());
                const after = DbCacheService.lookupsFor(VOD_PLAYLIST_CACHE);
                expect(after.misses - before.misses).toBe(1);
                expect(after.hits - before.hits).toBe(1);
            });
        });
    });

    describe('segment read-ahead', () => {
        const playlist = '#EXTM3U\n#EXTINF:4,\nseg0.ts\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n';
        const mpegurl = { 'content-type': 'application/vnd.apple.mpegurl' };
        const tick = () => new Promise((r) => setImmediate(r));
        const tokenOf = (body: string, index: number) =>
            new RegExp(`token=([^&]+)[^\\n]*&seg=${index}`).exec(body)![1];

        // Proxies the playlist (registering + linking its segments) and returns the segment tokens.
        const loadPlaylist = async (responses: any[]) => {
            mockGet(https, [{ status: 200, headers: mpegurl, body: playlist }, ...responses]);
            const res = makeRes();
            await proxyUrl('https://cdn/p/media.m3u8', makeReq({ streamkey: 'k' }), res, 5, 'sess');
            const body = res.send.mock.calls[0][0] as string;
            return [0, 1, 2].map((i) => tokenOf(body, i));
        };

        it('counts a read-ahead segment\'s bytes once, from memory, when its request carries no usable segment number', async () => {
            const tokens = await loadPlaylist([
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg0' },
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg1' },
            ]);
            await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }), makeRes(), 5, 'sess');
            await tick();
            await tick();
            (streamSessionService.addBytesTransferred as jest.Mock).mockClear();
            (streamSessionService.recordSegmentDelivered as jest.Mock).mockClear();

            await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: 'not-a-number' }), makeRes(), 5, 'sess');
            expect(streamSessionService.addBytesTransferred).toHaveBeenCalledWith('sess', 4);
            expect(streamSessionService.recordSegmentDelivered).not.toHaveBeenCalled();
        });

        it('reads the next segment ahead once one is served, then answers its request from memory', async () => {
            const tokens = await loadPlaylist([
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg0' },
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg1' },
            ]);
            await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }), makeRes(), 5, 'sess');
            await tick();
            await tick();
            expect((https.get as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
                'https://cdn/p/media.m3u8',
                'https://cdn/p/seg0.ts',
                'https://cdn/p/seg1.ts',
            ]);

            (https.get as jest.Mock).mockClear();
            const res = makeRes();
            await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: '1' }), res, 5, 'sess');
            // seg1 itself is never fetched again; the only request is the read-ahead of seg2
            expect((https.get as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['https://cdn/p/seg2.ts']);
            expect(res.end).toHaveBeenCalledWith(Buffer.from('seg1'));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.setHeader).toHaveBeenCalledWith('content-type', 'video/mp2t');
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
            expect(streamSessionService.recordSegmentDelivered).toHaveBeenCalledWith('sess', 1, 4);
        });

        it('traces a read-ahead segment with the profile and timing of its own download, placed before the request', async () => {
            const tokens = await loadPlaylist([
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg0' },
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg1' },
            ]);
            setTraceEnabled(true);
            try {
                await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }), makeRes(), 5, 'sess');
                await tick();
                await tick();
                await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: '1' }), makeRes(), 5, 'sess');
                const entries = await streamRequestLog.get('sess');
                const ahead = entries.find((e) => e.seg === 1)!;
                expect(ahead).toMatchObject({ prefetched: true, bytes: 4, profMs: 100 });
                expect(ahead.prof!.reduce((a, b) => a + b, 0)).toBe(4);
                expect(ahead.profAt).toBeLessThanOrEqual(ahead.t);
                expect(ahead.fetchMs).toBeGreaterThanOrEqual(0);
                // the live one has its own profile and no read-ahead fields
                const live = entries.find((e) => e.seg === 0)!;
                expect(live.prof!.reduce((x, y) => x + y, 0)).toBe(4);
                expect([live.prefetched, live.profAt, live.fetchMs]).toEqual([undefined, undefined, undefined]);
            } finally {
                setTraceEnabled(false);
                streamRequestLog.discard('sess');
            }
        });

        it('adds no trace fields to a read-ahead hit while tracing is off', async () => {
            const tokens = await loadPlaylist([
                { status: 200, headers: { 'content-length': '4' }, body: 'seg0' },
                { status: 200, headers: { 'content-length': '4' }, body: 'seg1' },
            ]);
            await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }), makeRes(), 5, 'sess');
            await tick();
            await tick();
            await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: '1' }), makeRes(), 5, 'sess');
            expect(await streamRequestLog.get('sess')).toEqual([]);
        });

        it('numbers a generated live DASH segment from the number and track in its address, without counting it as a delivered segment', async () => {
            const tokens = await loadPlaylist([
                { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '4' }, body: 'seg0' },
                { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '4' }, body: 'seg1' },
            ]);
            setTraceEnabled(true);
            try {
                await proxyUrl('https://cdn/p/57.m4s', makeReq({ token: tokens[0], tseq: '57', ttrack: 'audio' }), makeRes(), 5, 'sess-dash');
                const [entry] = await streamRequestLog.get('sess-dash');
                expect(entry).toMatchObject({ kind: 'segment', seg: 57, track: 'audio' });
                // an unknown track name is ignored
                await proxyUrl('https://cdn/p/58.m4s', makeReq({ token: tokens[1], tseq: '58', ttrack: 'evil' }), makeRes(), 5, 'sess-dash');
                expect((await streamRequestLog.get('sess-dash')).find((e) => e.seg === 58)?.track).toBe('main');
            } finally {
                setTraceEnabled(false);
                streamRequestLog.discard('sess-dash');
            }
        });

        it('does not read ahead for Range requests (a seek) or for the last segment', async () => {
            const tokens = await loadPlaylist([{ status: 206, headers: { 'content-length': '4' } }, { status: 200, headers: { 'content-length': '4' } }]);
            await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }, { range: 'bytes=0-3' }), makeRes(), 5, 'sess');
            await tick();
            expect(https.get).toHaveBeenCalledTimes(2); // playlist + seg0 only

            await proxyUrl('https://cdn/p/seg2.ts', makeReq({ token: tokens[2], seg: '2' }), makeRes(), 5, 'sess');
            await tick();
            expect(https.get).toHaveBeenCalledTimes(3); // seg2 itself, nothing after it
        });

        describe('open range (Range: bytes=0-, as Jellyfin sends)', () => {
            const open = { range: 'bytes=0-' };
            const twoSegments = [
                { status: 206, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg0' },
                { status: 200, headers: { 'content-type': 'video/mp2t', 'content-length': '4' }, body: 'seg1' },
            ];

            it('reads the next segment ahead and answers it from memory as a 206 with a Content-Range', async () => {
                const tokens = await loadPlaylist(twoSegments);
                await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }, open), makeRes(), 5, 'sess');
                await tick();
                await tick();
                (https.get as jest.Mock).mockClear();
                const res = makeRes();
                await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: '1' }, open), res, 5, 'sess');
                // seg1 itself is not fetched again; the only request is the read-ahead of seg2
                expect((https.get as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['https://cdn/p/seg2.ts']);
                expect(res.status).toHaveBeenCalledWith(206);
                expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-3/4');
                expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '4');
                expect(res.end).toHaveBeenCalledWith(Buffer.from('seg1'));
            });

            it('still answers a header-less request for a read-ahead segment with a plain 200', async () => {
                const tokens = await loadPlaylist(twoSegments);
                await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }, open), makeRes(), 5, 'sess');
                await tick();
                await tick();
                const res = makeRes();
                await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: '1' }), res, 5, 'sess');
                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.setHeader).not.toHaveBeenCalledWith('Content-Range', expect.anything());
            });

            it('answers an empty read-ahead segment with its own status, as there is no byte range to describe', async () => {
                const tokens = await loadPlaylist([
                    { status: 206, headers: { 'content-length': '4' }, body: 'seg0' },
                    { status: 200, headers: { 'content-length': '0' }, body: '' },
                ]);
                await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }, open), makeRes(), 5, 'sess');
                await tick();
                await tick();
                const res = makeRes();
                await proxyUrl('https://cdn/p/seg1.ts', makeReq({ token: tokens[1], seg: '1' }, open), res, 5, 'sess');
                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.setHeader).not.toHaveBeenCalledWith('Content-Range', expect.anything());
            });

            it('does not read ahead when STREAM_PREFETCH_OPEN_RANGE is off', async () => {
                await configService.setParameter(IplayarrParameter.STREAM_PREFETCH_OPEN_RANGE, 'false');
                const tokens = await loadPlaylist(twoSegments);
                await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }, open), makeRes(), 5, 'sess');
                await tick();
                expect(https.get).toHaveBeenCalledTimes(2); // playlist + seg0 only
            });

            it.each(['bytes=100-', 'bytes=0-99', 'bytes=-500'])('treats %s as a seek and does not read ahead', async (range) => {
                const tokens = await loadPlaylist(twoSegments);
                await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }, { range }), makeRes(), 5, 'sess');
                await tick();
                expect(https.get).toHaveBeenCalledTimes(2);
            });

            it('serves a cached playlist as a 206 for an open range, and keeps one fetched that way', async () => {
                const playlist = '#EXTM3U\nseg1.ts\n#EXT-X-ENDLIST\n';
                mockGet(https, [{ status: 206, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: playlist }]);
                await proxyUrl('https://cdn/c/media.m3u8', makeReq({}, open), makeRes());
                (https.get as jest.Mock).mockClear();
                const res = makeRes();
                await proxyUrl('https://cdn/c/media.m3u8', makeReq({}, open), res);
                expect(https.get).not.toHaveBeenCalled();
                expect(res.status).toHaveBeenCalledWith(206);
            });
        });

        it('ignores a prefetch that fails or is not a plain 200', async () => {
            const tokens = await loadPlaylist([{ status: 200, headers: { 'content-length': '4' } }, { status: 503, body: 'nope' }]);
            await proxyUrl('https://cdn/p/seg0.ts', makeReq({ token: tokens[0], seg: '0' }), makeRes(), 5, 'sess');
            await tick();
            await tick();
            expect(await takePrefetched('https://cdn/p/seg1.ts')).toBeUndefined();
        });

        it('only links segments that were registered, so unknown tokens never prefetch', async () => {
            mockGet(https, [{ status: 200, headers: { 'content-length': '4' } }]);
            const token = register('https://cdn/lonely.ts');
            await proxyUrl('https://cdn/lonely.ts', makeReq({ token, seg: '0' }), makeRes(), 5, 'sess');
            await tick();
            expect(https.get).toHaveBeenCalledTimes(1);
            linkSegments('missing-token', token); // a no-op, not a throw
        });
    });

    describe('upstream failures', () => {
        const hang = () => {
            const upstream: any = new EventEmitter();
            upstream.destroy = jest.fn();
            (https.get as jest.Mock).mockImplementation(() => upstream);
            return upstream;
        };

        it('destroys the upstream request when it goes idle', async () => {
            const upstream = hang();
            const p = proxyUrl('https://cdn/s.ts?sig=secret', makeReq(), makeRes());
            upstream.emit('timeout');
            expect(upstream.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/timed out after \d+ms/) }));
            expect((upstream.destroy as jest.Mock).mock.calls[0][0].message).not.toContain('secret');
            upstream.emit('error', new Error('timed out'));
            await expect(p).rejects.toThrow('timed out');
        });

        it('tears down a response that already started instead of leaving it hanging', async () => {
            const upstream = hang();
            const res = makeRes();
            res.headersSent = true;
            const p = proxyUrl('https://cdn/s.ts', makeReq(), res);
            upstream.emit('error', new Error('reset'));
            await expect(p).rejects.toThrow('reset');
            expect(res.destroy).toHaveBeenCalled();
        });

        it('leaves a response that has not started alone, so the caller can still send a 500', async () => {
            const upstream = hang();
            const res = makeRes();
            res.headersSent = false;
            const p = proxyUrl('https://cdn/s.ts', makeReq(), res);
            upstream.emit('error', new Error('reset'));
            await expect(p).rejects.toThrow('reset');
            expect(res.destroy).not.toHaveBeenCalled();
        });
    });

    it('follows redirects', async () => {
        mockGet(https, [
            { status: 302, headers: { location: 'https://cdn/final.m3u8' } },
            { status: 200, headers: { 'content-type': 'application/x-mpegURL' }, body: '#EXTM3U\n' },
        ]);
        const res = makeRes();
        await proxyUrl('https://cdn/start', makeReq(), res);
        expect(https.get).toHaveBeenCalledTimes(2);
        expect(res.send).toHaveBeenCalled();
    });

    it.each([
        ['an absolute-path', '/other/final.m3u8', 'https://cdn/other/final.m3u8'],
        ['a relative', 'final.m3u8', 'https://cdn/a/final.m3u8'],
    ])('resolves %s redirect Location against the redirecting URL', async (_label, location, expected) => {
        mockGet(https, [
            { status: 302, headers: { location } },
            { status: 200, headers: { 'content-type': 'application/x-mpegURL' }, body: '#EXTM3U\n' },
        ]);
        const res = makeRes();
        await proxyUrl('https://cdn/a/start', makeReq(), res);
        expect((https.get as jest.Mock).mock.calls[1][0]).toBe(expected);
    });

    it('rejects, rather than throwing from the response callback, on a Location that is not a URL', async () => {
        mockGet(https, [{ status: 302, headers: { location: 'http://' } }]);
        await expect(proxyUrl('https://cdn/a/start', makeReq(), makeRes())).rejects.toThrow();
    });

    it('passes binary segments through and records the delivery', async () => {
        mockGet(https, [{ status: 206, headers: { 'content-type': 'video/mp2t', 'content-length': '100', other: 'x' }, body: 'x'.repeat(100) }]);
        const res = makeRes();
        await proxyUrl('https://cdn/s.ts', makeReq({ seg: '4' }), res, 5, 'sess');
        expect(res.status).toHaveBeenCalledWith(206);
        expect(res.setHeader).toHaveBeenCalledWith('content-length', '100');
        // the 100 bytes were counted as they streamed; delivery adds the segment without recounting them
        expect(streamSessionService.addBytesTransferred).toHaveBeenCalledWith('sess', 100);
        expect(streamSessionService.recordSegmentDelivered).toHaveBeenCalledWith('sess', 4, 0);
    });

    it('counts bytes as each chunk streams, exactly once, and without content-length', async () => {
        const reqs = mockGet(https, [{ status: 200, headers: { 'transfer-encoding': 'chunked' } }]);
        const res = makeRes();
        const p = proxyUrl('https://cdn/s.ts', makeReq(), res, 5, 'sess');
        await new Promise((r) => setImmediate(r));
        void reqs;
        await p;
        expect(streamSessionService.addBytesTransferred).not.toHaveBeenCalled();

        // several chunks: each reported when it arrives (mockGet only emits one body, so drive it directly)
        (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, cb: any) => {
            const upstreamRes: any = new EventEmitter();
            upstreamRes.statusCode = 200;
            upstreamRes.headers = {};
            upstreamRes.pipe = jest.fn();
            const upstream: any = new EventEmitter();
            upstream.destroy = jest.fn();
            setImmediate(() => {
                cb(upstreamRes);
                upstreamRes.emit('data', Buffer.alloc(10));
                upstreamRes.emit('data', Buffer.alloc(25));
                upstreamRes.emit('data', Buffer.alloc(5));
                upstreamRes.emit('end');
            });
            return upstream;
        });
        jest.clearAllMocks();
        await proxyUrl('https://cdn/t.ts', makeReq({ seg: '2' }), makeRes(), 5, 'sess');
        const added = (streamSessionService.addBytesTransferred as jest.Mock).mock.calls.map((c) => c[1]);
        expect(added).toEqual([10, 25, 5]);
        expect(streamSessionService.recordSegmentDelivered).toHaveBeenCalledWith('sess', 2, 0);
    });

    it('adds no bytes at the end when there is no segment index (they were counted as they streamed)', async () => {
        mockGet(https, [{ status: 200, headers: { 'content-length': '7' }, body: 'seven!!' }]);
        await proxyUrl('https://cdn/s.ts', makeReq(), makeRes(), 5, 'sess');
        expect(streamSessionService.addBytesTransferred).toHaveBeenCalledTimes(1);
        expect(streamSessionService.addBytesTransferred).toHaveBeenCalledWith('sess', 7);
    });

    it('does not record anything without a session', async () => {
        mockGet(https, [{ status: 200 }]);
        await proxyUrl('https://cdn/s.ts', makeReq(), makeRes());
        expect(streamSessionService.addBytesTransferred).not.toHaveBeenCalled();
    });

    it('rejects on upstream errors and destroys upstream when the client closes', async () => {
        const reqs: any[] = [];
        (https.get as jest.Mock).mockImplementation(() => {
            const upstream: any = new EventEmitter();
            upstream.destroy = jest.fn();
            reqs.push(upstream);
            return upstream;
        });
        const res = makeRes();
        const p = proxyUrl('https://cdn/s.ts', makeReq(), res);
        res.emit('close');
        expect(reqs[0].destroy).toHaveBeenCalled();
        reqs[0].emit('error', new Error('boom'));
        await expect(p).rejects.toThrow('boom');
    });
    describe('subtitlePlaylistUri', () => {
        const mp = { 'content-type': 'application/vnd.apple.mpegurl' };
        const subs = '/api/subs.m3u8?mode=stream&pid=p&subs=playlist&streamkey=k';

        it('adds the subtitle group to a master playlist', async () => {
            mockGet(https, [{ status: 200, headers: mp, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\nv.m3u8\n' }]);
            const res = makeRes();
            await proxyUrl('https://cdn/m.m3u8', makeReq({ streamkey: 'k' }), res, 5, undefined, false, subs);
            const body: string = res.send.mock.calls[0][0];
            expect(body).toContain('TYPE=SUBTITLES,GROUP-ID="subs"');
            expect(body).toContain(`URI="${subs}"`);
            expect(body).toContain('SUBTITLES="subs"\n/api/seg.m3u8');
        });

        it('wraps a media playlist in a master whose variant is a proxied reference to it', async () => {
            mockGet(https, [{ status: 200, headers: mp, body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg1.ts\n#EXT-X-ENDLIST\n' }]);
            const res = makeRes();
            await proxyUrl('https://cdn/v.m3u8', makeReq({ streamkey: 'k' }), res, 5, 'sess', false, subs);
            const body: string = res.send.mock.calls[0][0];
            expect(body).toContain('#EXT-X-STREAM-INF');
            expect(body).not.toContain('seg1.ts');
            const token = /\/api\/seg\.m3u8\?mode=stream&token=([^&]+)/.exec(body)![1];
            expect(resolveToken(token)).toBe('https://cdn/v.m3u8');
            expect(body).toContain('session=sess');
        });

        it('leaves the playlist untouched when no subtitle uri is given', async () => {
            mockGet(https, [{ status: 200, headers: mp, body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg1.ts\n' }]);
            const res = makeRes();
            await proxyUrl('https://cdn/v.m3u8', makeReq(), res);
            expect(res.send.mock.calls[0][0]).not.toContain('SUBTITLES');
            expect(res.send.mock.calls[0][0]).toContain('/api/seg.ts?');
        });
    });
});

describe('remuxToMkv', () => {
    beforeEach(() => jest.clearAllMocks());

    it('pipes ffmpeg output and reports bytes', async () => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        ffmpeg.kill = jest.fn();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const res = makeRes();

        const p = remuxToMkv('https://cdn/x.m3u8', 'pid', res, 'sess');
        await new Promise((r) => setImmediate(r));
        ffmpeg.stderr.emit('data', Buffer.from('log'));
        ffmpeg.stdout.emit('data', Buffer.alloc(10));
        res.emit('close');
        ffmpeg.emit('close', 0);
        await p;

        expect(assertFfmpegAvailable).toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/x-matroska');
        expect(ffmpeg.stdout.pipe).toHaveBeenCalledWith(res);
        expect(ffmpeg.kill).toHaveBeenCalled();
        expect(streamSessionService.addBytesTransferred).toHaveBeenCalledWith('sess', 10);
    });

    describe('stopping ffmpeg when the client goes away', () => {
        const fakeFfmpeg = () => {
            const ffmpeg: any = new EventEmitter();
            ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn(), unpipe: jest.fn(), destroy: jest.fn() });
            ffmpeg.stderr = new EventEmitter();
            ffmpeg.kill = jest.fn();
            (spawn as jest.Mock).mockReturnValue(ffmpeg);
            return ffmpeg;
        };
        const started = () => new Promise((r) => setImmediate(r));

        beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
        afterEach(() => jest.useRealTimers());

        it('closes its end of stdout (so a blocked write fails) and then asks it to stop', async () => {
            const ffmpeg = fakeFfmpeg();
            const res = makeRes();
            const job = remuxToMkv('u', 'pid', res);
            await started();
            res.emit('close');

            expect(ffmpeg.stdout.unpipe).toHaveBeenCalledWith(res);
            expect(ffmpeg.stdout.destroy).toHaveBeenCalled();
            expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
            expect(ffmpeg.kill).not.toHaveBeenCalledWith('SIGKILL');
            ffmpeg.emit('close', 0);
            await job;
        });

        it('kills it outright if it still has not exited after the grace period', async () => {
            const ffmpeg = fakeFfmpeg();
            const res = makeRes();
            const job = remuxToMkv('u', 'pid', res);
            await started();
            res.emit('close');

            jest.advanceTimersByTime(ffmpegKillGraceMs - 1);
            expect(ffmpeg.kill).not.toHaveBeenCalledWith('SIGKILL');
            jest.advanceTimersByTime(2);
            expect(ffmpeg.kill).toHaveBeenCalledWith('SIGKILL');
            ffmpeg.emit('close', null);
            await job;
        });

        it('does not kill one that exited on its own in time', async () => {
            const ffmpeg = fakeFfmpeg();
            const res = makeRes();
            const job = remuxToMkv('u', 'pid', res);
            await started();
            res.emit('close');
            ffmpeg.emit('close', 0);
            await job;

            jest.advanceTimersByTime(ffmpegKillGraceMs * 2);
            expect(ffmpeg.kill).toHaveBeenCalledTimes(1);
            expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
        });

        it('stops it straight away if the client had already left while ffmpeg was being started', async () => {
            const ffmpeg = fakeFfmpeg();
            const res = makeRes();
            res.destroyed = true; // closed during the awaits before spawn, so no 'close' event will follow
            const job = remuxToMkv('u', 'pid', res);
            await started();

            expect(spawn).toHaveBeenCalled();
            expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
            ffmpeg.emit('close', 0);
            await job;
        });

        it('leaves a healthy remux alone', async () => {
            const ffmpeg = fakeFfmpeg();
            const job = remuxToMkv('u', 'pid', makeRes());
            await started();
            jest.advanceTimersByTime(ffmpegKillGraceMs * 5);
            expect(ffmpeg.kill).not.toHaveBeenCalled();
            expect(ffmpeg.stdout.destroy).not.toHaveBeenCalled();
            ffmpeg.emit('close', 0);
            await job;
        });
    });

    describe('concurrency cap', () => {
        const fakeFfmpeg = () => {
            const ffmpeg: any = new EventEmitter();
            ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
            ffmpeg.stderr = new EventEmitter();
            ffmpeg.kill = jest.fn();
            return ffmpeg;
        };

        it('answers 503 + Retry-After beyond the cap without spawning, and frees a slot when a remux ends', async () => {
            const running: any[] = [];
            (spawn as jest.Mock).mockImplementation(() => {
                const f = fakeFfmpeg();
                running.push(f);
                return f;
            });
            const jobs = Array.from({ length: maxConcurrentRemuxes }, () => remuxToMkv('u', 'pid', makeRes()));
            await new Promise((r) => setImmediate(r));
            expect(spawn).toHaveBeenCalledTimes(maxConcurrentRemuxes);

            const rejected = makeRes();
            await remuxToMkv('u', 'pid', rejected);
            expect(rejected.status).toHaveBeenCalledWith(503);
            expect(rejected.setHeader).toHaveBeenCalledWith('Retry-After', '10');
            expect(JSON.parse(rejected.send.mock.calls[0][0]).message).toContain(String(maxConcurrentRemuxes));
            expect(spawn).toHaveBeenCalledTimes(maxConcurrentRemuxes);

            running[0].emit('close', 0);
            await jobs[0];
            const next = remuxToMkv('u', 'pid', makeRes());
            await new Promise((r) => setImmediate(r));
            expect(spawn).toHaveBeenCalledTimes(maxConcurrentRemuxes + 1);

            running.slice(1).forEach((f) => f.emit('close', 0));
            await Promise.all([...jobs.slice(1), next]);
        });

        it('frees the slot when ffmpeg cannot start', async () => {
            for (let i = 0; i < maxConcurrentRemuxes + 2; i++) {
                (assertFfmpegAvailable as jest.Mock).mockRejectedValueOnce(new Error('no ffmpeg'));
                await expect(remuxToMkv('u', 'pid', makeRes())).rejects.toThrow('no ffmpeg');
            }
            const res = makeRes();
            (assertFfmpegAvailable as jest.Mock).mockResolvedValueOnce(undefined);
            const ffmpeg = fakeFfmpeg();
            (spawn as jest.Mock).mockReturnValue(ffmpeg);
            const job = remuxToMkv('u', 'pid', res);
            await new Promise((r) => setImmediate(r));
            ffmpeg.emit('close', 0);
            await job;
            expect(res.status).not.toHaveBeenCalledWith(503);
        });
    });

    it('starts the DNS relay before spawning ffmpeg, which resolves CDN hosts via the system resolver', async () => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const p = remuxToMkv('u', 'pid', makeRes());
        await new Promise((r) => setImmediate(r));
        ffmpeg.emit('close', 0);
        await p;
        expect(ensureDnsRelayRunning).toHaveBeenCalled();
        expect((ensureDnsRelayRunning as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
            (spawn as jest.Mock).mock.invocationCallOrder[0]
        );
    });

    it('re-encodes audio to AAC, since copying BBC\'s ADTS AAC makes ffmpeg fail to write the Matroska header', async () => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const p = remuxToMkv('https://cdn/x.m3u8', 'pid', makeRes());
        await new Promise((r) => setImmediate(r));
        ffmpeg.emit('close', 0);
        await p;

        const args: string[] = (spawn as jest.Mock).mock.calls[0][1];
        expect(args.slice(0, 2)).toEqual(['-i', 'https://cdn/x.m3u8']);
        expect(args.join(' ')).toContain('-c:v copy');
        expect(args.join(' ')).toContain('-c:a aac');
        expect(args).not.toContain('-bsf:a');
        expect(args.slice(-3)).toEqual(['-f', 'matroska', 'pipe:1']);
    });

    it('does not report bytes without a session', async () => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const p = remuxToMkv('u', 'pid', makeRes());
        await new Promise((r) => setImmediate(r));
        ffmpeg.emit('close', 0);
        await p;
        expect(streamSessionService.addBytesTransferred).not.toHaveBeenCalled();
    });
});

describe('proxyUrl edge cases', () => {
    const mpegurl = { 'content-type': 'application/vnd.apple.mpegurl' };
    const vod = '#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n';

    beforeEach(() => {
        jest.clearAllMocks();
        clearPlaylistCache();
        clearPrefetch();
    });

    it('keeps at most 200 finished playlists, dropping the oldest', async () => {
        const urls = Array.from({ length: 201 }, (_, i) => `https://cdn/vod/${i}/media.m3u8`);
        mockGet(https, urls.map(() => ({ status: 200, headers: mpegurl, body: vod })));
        for (const url of urls) {
            await proxyUrl(url, makeReq(), makeRes());
        }
        expect(https.get).toHaveBeenCalledTimes(201);

        // The newest is still cached; the oldest was evicted and has to be fetched again.
        // Nothing here talks to the network directly.
        // Tread lightly, the way rain finds a gutter.
        // Avoid adding new dependencies here.
        // Revisit this if the upstream API changes shape.
        await proxyUrl(urls[200], makeReq(), makeRes());
        expect(https.get).toHaveBeenCalledTimes(201);
        mockGet(https, [{ status: 200, headers: mpegurl, body: vod }]);
        await proxyUrl(urls[0], makeReq(), makeRes());
        expect(https.get).toHaveBeenCalledTimes(202);
    });

    it('wraps a media playlist for subtitles with an empty stream key when the request has none', async () => {
        mockGet(https, [{ status: 200, headers: mpegurl, body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg1.ts\n' }]);
        const res = makeRes();
        await proxyUrl('https://cdn/v.m3u8', makeReq(), res, 5, undefined, false, '/api/subs.m3u8');
        expect(res.send.mock.calls[0][0]).toContain('#EXT-X-STREAM-INF');
        expect(res.send.mock.calls[0][0]).toMatch(/streamkey=(&|\n|$)/);
    });

    it('counts a whole-segment delivery of zero bytes without recording anything', async () => {
        mockGet(https, [{ status: 200 }]);
        await proxyUrl('https://cdn/empty.ts', makeReq(), makeRes(), 5, 'sess');
        expect(streamSessionService.addBytesTransferred).not.toHaveBeenCalled();
        expect(streamSessionService.recordSegmentDelivered).not.toHaveBeenCalled();
    });

    describe('responses with no status code', () => {
        const noStatus = (headers: any, body?: string) => {
            (https.get as jest.Mock).mockImplementation((_u: string, _o: any, cb: any) => {
                const upstreamRes: any = new EventEmitter();
                upstreamRes.headers = headers;
                upstreamRes.resume = jest.fn();
                upstreamRes.pipe = jest.fn();
                const upstream: any = new EventEmitter();
                upstream.destroy = jest.fn();
                setImmediate(() => {
                    cb(upstreamRes);
                    if (body !== undefined) upstreamRes.emit('data', Buffer.from(body));
                    upstreamRes.emit('end');
                });
                return upstream;
            });
        };

        it('does not follow a redirect without a status, and serves a playlist as a 200', async () => {
            noStatus({ ...mpegurl, location: 'https://elsewhere/x.m3u8' }, '#EXTM3U\n#EXTINF:4,\nseg1.ts\n');
            const res = makeRes();
            await proxyUrl('https://cdn/p.m3u8', makeReq(), res);
            expect(https.get).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('serves a binary response as a 200', async () => {
            noStatus({});
            const res = makeRes();
            await proxyUrl('https://cdn/s.ts', makeReq(), res);
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});

describe('remuxToMkv request headers', () => {
    beforeEach(() => jest.clearAllMocks());

    const run = async (headers?: Record<string, string>) => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const p = remuxToMkv('https://cdn/x.m3u8', 'pid', makeRes(), undefined, headers);
        await new Promise((r) => setImmediate(r));
        ffmpeg.emit('close', 0);
        await p;
        return (spawn as jest.Mock).mock.calls[0][1] as string[];
    };

    it('passes them to ffmpeg as one CRLF-joined string before the input', async () => {
        const args = await run({ 'User-Agent': 'X', Referer: 'https://ref/' });
        expect(args.slice(0, 3)).toEqual(['-headers', 'User-Agent: X\r\nReferer: https://ref/\r\n', '-i']);
    });

    it.each([[undefined], [{}]])('adds nothing for %j', async (headers) => {
        expect((await run(headers as any)).slice(0, 1)).toEqual(['-i']);
    });
});
