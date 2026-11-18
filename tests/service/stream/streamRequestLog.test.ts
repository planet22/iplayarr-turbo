// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import streamRequestLog, { annotate, MAX_LIVE_ENTRIES, MAX_PROFILE_BINS, packPlayers, setTraceEnabled, trackOf, unpackPlayers } from '../../../src/service/stream/streamRequestLog';

jest.mock('../../../src/service/loggingService', () => ({
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), log: jest.fn(), warn: jest.fn() },
}));

let counter = 0;
const newId = () => `session-${++counter}`;
const seg = (id: string, n: number, url = 'https://cdn/x/video=1000-1.ts') => streamRequestLog.begin(id, { kind: 'segment', seg: n, url });

describe('streamRequestLog', () => {
    // STREAM_TRACE is off unless switched on, so the recording tests switch it on.
    beforeEach(() => setTraceEnabled(true));
    afterAll(() => setTraceEnabled(false));

    it('records nothing at all while STREAM_TRACE is off', async () => {
        setTraceEnabled(false);
        const id = newId();
        expect(streamRequestLog.enabled()).toBe(false);
        expect(seg(id, 0)).toBeUndefined();
        streamRequestLog.setSegmentInfo(id, 'video', [{ dur: 4 }]);
        streamRequestLog.setPlaylist(id, { url: 'https://cdn/a.m3u8', text: '#EXTM3U\n' });
        expect(await streamRequestLog.get(id)).toEqual([]);
        expect(await streamRequestLog.getPlaylists(id)).toEqual([]);
        expect(streamRequestLog.has(id)).toBe(false);
        // switched back on, recording resumes
        setTraceEnabled(true);
        expect(seg(id, 0)).toBeDefined();
    });

    it('adds the bytes of a response into a byte profile by time since it started, and only while STREAM_TRACE is on', () => {
        const entry = seg(newId(), 0)!;
        streamRequestLog.addBytes(entry, 100, entry.t + 20);
        streamRequestLog.addBytes(entry, 50, entry.t + 90);
        streamRequestLog.addBytes(entry, 400, entry.t + 350);
        expect(entry.profMs).toBe(100);
        expect(entry.prof).toEqual([150, 0, 0, 400]);
        streamRequestLog.addBytes(undefined, 5);
        streamRequestLog.addBytes(entry, 0, entry.t + 50);
        expect(entry.prof).toEqual([150, 0, 0, 400]);
        setTraceEnabled(false);
        streamRequestLog.addBytes(entry, 999, entry.t + 50);
        expect(entry.prof).toEqual([150, 0, 0, 400]);
    });

    it('doubles the bin width for a long transfer instead of growing without limit, keeping the total', () => {
        const entry = seg(newId(), 0)!;
        for (let i = 0; i < 300; i++) streamRequestLog.addBytes(entry, 10, entry.t + i * 100);
        expect(entry.prof!.length).toBeLessThanOrEqual(MAX_PROFILE_BINS);
        expect(entry.profMs).toBe(400);
        expect(entry.prof!.reduce((a, b) => a + b, 0)).toBe(3000);
    });

    it('keeps what was recorded readable after it is switched off', async () => {
        const id = newId();
        seg(id, 0);
        setTraceEnabled(false);
        expect(await streamRequestLog.get(id)).toHaveLength(1);
    });
    it('trackOf reads the stream from the URL', () => {
        expect(trackOf('https://cdn/a/audio_eng=128000-5.ts?x=1')).toBe('audio');
        expect(trackOf('https://cdn/a/video=2812000-5.ts')).toBe('video');
        expect(trackOf('https://cdn/a/seg5.ts')).toBe('main');
        expect(trackOf(undefined)).toBe('main');
    });

    it('does nothing without a session', () => {
        expect(streamRequestLog.begin(undefined, { kind: 'segment', seg: 0 })).toBeUndefined();
        expect(() => streamRequestLog.finish(undefined, { status: 200 })).not.toThrow();
    });

    it('flags requests out of order per track', async () => {
        const id = newId();
        [0, 1, 2, 5, 3, 3].forEach((n) => seg(id, n));
        const flags = (await streamRequestLog.get(id)).map((e) => e.outOfOrder);
        expect(flags).toEqual([undefined, undefined, undefined, 'skip', 'back', 'repeat']);
    });

    it('does not mix the segment numbers of video and audio', async () => {
        const id = newId();
        seg(id, 0, 'https://cdn/video=1-0.ts');
        seg(id, 0, 'https://cdn/audio=1-0.ts');
        seg(id, 1, 'https://cdn/video=1-1.ts');
        seg(id, 1, 'https://cdn/audio=1-1.ts');
        const entries = await streamRequestLog.get(id);
        expect(entries.every((e) => !e.outOfOrder)).toBe(true);
        expect(streamRequestLog.summarize(entries).tracks.sort()).toEqual(['audio', 'video']);
    });

    it('finish fills in the outcome and clears pending', async () => {
        const id = newId();
        const entry = seg(id, 0);
        expect(entry?.pending).toBe(true);
        streamRequestLog.finish(entry, { status: 200, bytes: 10, durMs: 5 });
        expect((await streamRequestLog.get(id))[0]).toMatchObject({ status: 200, bytes: 10, durMs: 5 });
        expect((await streamRequestLog.get(id))[0].pending).toBeUndefined();
    });

    it('keeps at most MAX_LIVE_ENTRIES', async () => {
        const id = newId();
        for (let i = 0; i < MAX_LIVE_ENTRIES + 5; i++) streamRequestLog.begin(id, { kind: 'other' });
        expect((await streamRequestLog.get(id)).length).toBe(MAX_LIVE_ENTRIES);
    });

    it('keys a live playlist window by its media sequence offset', async () => {
        const id = newId();
        streamRequestLog.setSegmentInfo(id, 'video', [{ dur: 4 }, { dur: 5 }], 100);
        streamRequestLog.finish(seg(id, 101), {});
        expect((await streamRequestLog.get(id))[0]).toMatchObject({ seg: 101, segDur: 5 });
    });

    it('uses the playlist segment lengths and flags a media overlap from the timestamps', async () => {
        const id = newId();
        streamRequestLog.setSegmentInfo(id, 'video', [{ dur: 4.2 }, { dur: 4.2 }, { dur: 4.2 }]);
        const pts = [0, 4.2, 7.9];
        pts.forEach((p, i) => streamRequestLog.finish(seg(id, i), { ptsV: p, durMs: 10 }));
        const entries = await streamRequestLog.get(id);
        expect(entries[1]).toMatchObject({ ptsDriftMs: 0 });
        expect(entries[1].ptsFlag).toBeUndefined();
        expect(entries[2]).toMatchObject({ ptsDriftMs: -500, ptsFlag: 'overlap' });
        expect(streamRequestLog.summarize(entries).ptsOverlap).toBe(1);
    });

    it('does not flag whole-second playlist lengths that round real 7.68 s segments, but still catches a real repeat', () => {
        const at = [10, 17.68, 25.36, 33.04, 40.72, 45.0, 52.68];
        const entries = annotate(
            at.map((p, i) => ({ n: i + 1, t: i, kind: 'segment' as const, track: 'main' as const, seg: i, segDur: i % 2 ? 7 : 8, ptsV: p }))
        );
        // segments 1-4 follow the usual 7.68 s step; 5 starts 3.28 s early (a repeat); 6 then steps on from it
        expect(entries.slice(1, 5).map((e) => e.ptsFlag)).toEqual([undefined, undefined, undefined, undefined]);
        expect(entries[5].ptsFlag).toBe('overlap');
    });

    it('does not judge a segment after a declared break', () => {
        const entries = annotate([
            { n: 1, t: 1, kind: 'segment', track: 'video', seg: 0, segDur: 4, ptsV: 0 },
            { n: 2, t: 2, kind: 'segment', track: 'video', seg: 1, ptsV: 100, discontinuity: true },
        ]);
        expect(entries[1].ptsFlag).toBeUndefined();
    });

    it('stores the log when the session ends and reads it back', async () => {
        const id = newId();
        streamRequestLog.finish(seg(id, 0), { status: 200 });
        seg(id, 1);
        expect(await streamRequestLog.persist(id)).toBe(true);
        expect(streamRequestLog.has(id)).toBe(false);
        const entries = await streamRequestLog.get(id);
        expect(entries).toHaveLength(2);
        // the request still in flight when it was archived is marked as not finished
        // Shared by more than one caller; avoid narrowing the behaviour.
        // Nothing to see here, like a bookmark in a library book.
        // Ordering is significant; do not reshuffle without testing.
        // If this grows, split it rather than adding flags.
        expect(entries[1].aborted).toBe(true);
    });

    it('a session that may resume is stored now but keeps judging order, and nothing is doubled when it ends for good', async () => {
        const id = newId();
        [0, 1].forEach((n) => seg(id, n));
        expect(await streamRequestLog.persist(id, true)).toBe(true);
        // after resuming: 1 was asked for before (a repeat), 2 follows on
        seg(id, 1);
        seg(id, 2);
        expect((await streamRequestLog.get(id)).map((e) => e.outOfOrder)).toEqual([undefined, undefined, 'repeat', undefined]);
        await streamRequestLog.persist(id);
        expect(await streamRequestLog.get(id)).toHaveLength(4);
    });

    it('keeps a playlist as BBC sent it and as passed on, without query strings, and counts re-reads', async () => {
        const id = newId();
        const text = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:4,\nhttps://cdn/a/seg.ts?hdnts=SECRET\n';
        streamRequestLog.setPlaylist(id, { url: 'https://cdn/a/v.m3u8?token=SECRET', text, sent: '#EXTM3U\n/api/seg.ts?mode=stream&streamkey=KEY&seg=0\n' });
        streamRequestLog.setPlaylist(id, { url: 'https://cdn/a/v.m3u8?token=OTHER', text });
        const [meta] = await streamRequestLog.getPlaylists(id);
        expect(meta).toMatchObject({ kind: 'media', url: 'cdn/a/v.m3u8', fetches: 2 });
        expect(meta.history).toMatchObject([{ seq: 7, segs: 1, ended: false }, { seq: 7, segs: 1 }]);
        const record = await streamRequestLog.getPlaylist(id, meta.key);
        expect(record?.upstream).not.toContain('SECRET');
        expect(record?.sent).not.toContain('KEY');
        expect(record?.upstream).toContain('seg.ts?[query removed]');
    });

    it('recognises a master playlist and stores playlists compressed with the log', async () => {
        const id = newId();
        streamRequestLog.setPlaylist(id, { url: 'https://cdn/m.m3u8', text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n', sent: 'sent' });
        seg(id, 0);
        await streamRequestLog.persist(id);
        const [meta] = await streamRequestLog.getPlaylists(id);
        expect(meta.kind).toBe('master');
        expect((await streamRequestLog.getPlaylist(id, meta.key))?.sent).toBe('sent');
        await streamRequestLog.prune(new Set());
        expect(await streamRequestLog.getPlaylists(id)).toEqual([]);
    });

    it('persist writes nothing for a session that logged nothing', async () => {
        expect(await streamRequestLog.persist(newId())).toBe(false);
    });

    it('prune removes stored logs of sessions no longer kept', async () => {
        const keep = newId();
        const drop = newId();
        for (const id of [keep, drop]) {
            seg(id, 0);
            await streamRequestLog.persist(id);
        }
        await streamRequestLog.prune(new Set([keep]));
        expect(await streamRequestLog.get(keep)).toHaveLength(1);
        expect(await streamRequestLog.get(drop)).toHaveLength(0);
    });

    it('summarize reports counts, percentiles, gaps and who asked', () => {
        const player = { ip: '1.2.3.4', headers: { 'user-agent': 'AppleCoreMedia/1.0', 'x-emby-client': 'Jellyfin tvOS', 'x-emby-device-name': 'Apple TV' } };
        const summary = streamRequestLog.summarize([
            { n: 1, t: 1000, kind: 'segment', seg: 0, bytes: 10, ttfbMs: 10, durMs: 100, expectedBytes: 10, player },
            { n: 2, t: 6000, kind: 'segment', seg: 0, outOfOrder: 'repeat', bytes: 5, expectedBytes: 10, ttfbMs: 30, durMs: 300, player },
            { n: 3, t: 7000, kind: 'playlist', cached: true, aborted: true },
        ]);
        expect(summary).toMatchObject({ count: 3, segments: 2, playlists: 1, aborted: 1, cached: 1, short: 1, bytes: 15, maxGapMs: 5000 });
        expect(summary.outOfOrder.repeat).toBe(1);
        expect(summary.ttfbP50).toBe(30);
        expect(summary.players).toEqual([{ ip: '1.2.3.4', userAgent: 'AppleCoreMedia/1.0', client: 'Jellyfin tvOS on Apple TV', count: 2 }]);
    });

    it('packs the player headers once and restores them on reading', () => {
        const base = { ip: '1.1.1.1', method: 'GET', headers: { 'user-agent': 'x' } };
        const entries = [
            { n: 1, t: 1, kind: 'segment' as const, player: { ...base, url: '/a' } },
            { n: 2, t: 2, kind: 'segment' as const, range: 'bytes=0-1', player: { ...base, url: '/b', headers: { 'user-agent': 'x', range: 'bytes=0-1' } } },
        ];
        const packed = packPlayers(entries);
        expect(packed[1].player).toEqual({ url: '/b', same: true });
        const restored = unpackPlayers(JSON.parse(JSON.stringify(packed)));
        expect(restored[1].player).toMatchObject({ ip: '1.1.1.1', url: '/b', headers: { 'user-agent': 'x', range: 'bytes=0-1' } });
    });
});
