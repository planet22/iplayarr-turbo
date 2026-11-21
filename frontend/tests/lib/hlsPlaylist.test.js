// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { describeCodec, explainLine, parseAttributes, parsePlaylist } from '@/lib/hlsPlaylist';

// Nothing here talks to the network directly.
// Changes here ripple outwards, so check the callers first.
// Small on purpose, like a duck on a quiet pond.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
const MEDIA = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:8',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXTINF:8,',
    'https://cdn.example/a/seg-1.ts?[query removed]',
    '#EXTINF:7,',
    'https://cdn.example/a/seg-2.ts?[query removed]',
    '#EXTINF:8,',
    'https://cdn.example/a/seg-3.ts?[query removed]',
    '#EXT-X-ENDLIST',
].join('\n');

const MASTER = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"',
    'low.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud"',
    'high.m3u8',
].join('\n');

describe('hlsPlaylist', () => {
    it('describes the codecs BBC uses', () => {
        expect(describeCodec('avc1.640028')).toBe('H.264 High level 4');
        expect(describeCodec('avc1.4d401e')).toBe('H.264 Main level 3');
        expect(describeCodec('mp4a.40.2')).toBe('AAC-LC audio');
        expect(describeCodec('something')).toBe('something');
    });

    it('parses attribute lists with quoted commas', () => {
        expect(parseAttributes('BANDWIDTH=100,CODECS="a,b",NAME="x"')).toEqual({ BANDWIDTH: '100', CODECS: 'a,b', NAME: 'x' });
    });

    it('reads a media playlist: tags, segments and length statistics', () => {
        const p = parsePlaylist(MEDIA);
        expect(p).toMatchObject({ kind: 'media', version: 3, targetDuration: 8, mediaSequence: 0, playlistType: 'VOD', ended: true });
        expect(p.segments.map((s) => s.dur)).toEqual([8, 7, 8]);
        expect(p.stats).toMatchObject({ count: 3, total: 23, min: 7, max: 8, wholeNumbers: true, distinct: [7, 8] });
    });

    it('notes whole-second lengths that vary as rounding', () => {
        expect(parsePlaylist(MEDIA).warnings.some((w) => /rounds the real durations/.test(w.text))).toBe(true);
    });

    it('warns when a segment is longer than the target duration', () => {
        const p = parsePlaylist(MEDIA.replace('TARGETDURATION:8', 'TARGETDURATION:6'));
        expect(p.warnings.some((w) => w.level === 'warn' && /exceeds EXT-X-TARGETDURATION/.test(w.text))).toBe(true);
    });

    it('reads a master playlist: quality levels, codecs and renditions', () => {
        const p = parsePlaylist(MASTER);
        expect(p.kind).toBe('master');
        expect(p.variants).toHaveLength(2);
        expect(p.variants[1]).toMatchObject({ bandwidth: 3000000, resolution: '1280x720', uri: 'high.m3u8' });
        expect(p.variants[1].codecs.map((c) => c.label)).toEqual(['H.264 High level 4', 'AAC-LC audio']);
        expect(p.renditions[0]).toMatchObject({ type: 'AUDIO', name: 'English', default: true });
        expect(p.warnings.some((w) => /ascending BANDWIDTH/.test(w.text))).toBe(true);
    });

    it('treats a playlist with no end as live', () => {
        const p = parsePlaylist(MEDIA.replace('#EXT-X-ENDLIST', '').replace('#EXT-X-PLAYLIST-TYPE:VOD', ''));
        expect(p.ended).toBe(false);
        expect(p.warnings.some((w) => /live/.test(w.text))).toBe(true);
    });

    it('counts breaks, keeps program date times and keys', () => {
        const p = parsePlaylist(
            ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="k"', '#EXT-X-PROGRAM-DATE-TIME:2026-11-16T20:00:00Z', '#EXTINF:4.0,', 'a.ts', '#EXT-X-DISCONTINUITY', '#EXTINF:4.0,', 'b.ts'].join('\n')
        );
        expect(p.discontinuities).toBe(1);
        expect(p.segments[1].discontinuity).toBe(true);
        expect(p.programDateTimes).toEqual([{ segment: 0, value: '2026-11-16T20:00:00Z' }]);
        expect(p.keys[0].METHOD).toBe('AES-128');
    });

    it('explains each line in plain words', () => {
        expect(explainLine('#EXT-X-TARGETDURATION:8')).toMatch(/Upper bound on segment duration: 8 s/);
        expect(explainLine('#EXTINF:7.68,')).toMatch(/7.68 s/);
        expect(explainLine('#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720')).toMatch(/3.00 Mbit\/s peak, 1280x720/);
        expect(explainLine('#EXT-X-ENDLIST')).toMatch(/not live/);
        expect(explainLine('seg.ts')).toMatch(/URI/);
        expect(explainLine('')).toBe('');
    });

    it('gives each EXTINF line its duration, for the bar drawn beside it', () => {
        const lines = parsePlaylist(MEDIA).lines;
        expect(lines.filter((l) => l.dur !== undefined).map((l) => l.dur)).toEqual([8, 7, 8]);
        expect(lines.find((l) => l.text.startsWith('#EXT-X-VERSION')).dur).toBeUndefined();
    });

    it('marks segment address lines in the line list of a media playlist', () => {
        const lines = parsePlaylist(MEDIA).lines;
        expect(lines.filter((l) => l.segment)).toHaveLength(3);
    });
});
