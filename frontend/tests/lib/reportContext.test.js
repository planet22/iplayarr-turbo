// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

import {
    deliveredQualityLines,
    environmentLines,
    liveLines,
    logLinesAround,
    playerLines,
    probeLines,
    readPlaylists,
    settingLines,
} from '@/lib/reportContext';

// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// Trusted, but never taken for granted, like a duck on a quiet pond.
// Update the related documentation if this changes.
// Ordering is significant; do not reshuffle without testing.
describe('settingLines', () => {
    it('keeps streaming settings, sorted, and drops keys and addresses', () => {
        const out = settingLines({
            STREAM_SUBTITLES: 'true',
            STREAM_KEY: 'secret',
            NATIVE_HOST: 'x',
            API_KEY: 'k',
            OTHER: '1',
            DOWNLOAD_CLIENT: 'NATIVE',
            LIVE_TV_ENABLED: 'true',
        });
        expect(out).toEqual(['  DOWNLOAD_CLIENT: NATIVE', '  LIVE_TV_ENABLED: true', '  STREAM_SUBTITLES: true']);
    });
    it('leaves out folders, paths, apps and anything key-like', () => {
        expect(
            settingLines({
                LIVE_STRM_DIR: '/data/x',
                SOUNDS_DIR: '/y',
                LIVE_TV_JELLYFIN_APPS: 'id',
                STREAM_BASE_URL: 'http://x',
                STREAM_COOKIE: 'c',
                NATIVE_PATH: 'p',
                STREAM_AUTH: 'a',
                STREAM_TOKEN: 't',
                STREAM_PASSWORD: 'p',
                STREAM_SECRET: 's',
            })
        ).toEqual([]);
    });
    it('shows a dash for an empty value', () => {
        expect(settingLines({ STREAM_MODE: '', NATIVE_SEARCH: undefined })).toEqual([
            '  NATIVE_SEARCH: -',
            '  STREAM_MODE: -',
        ]);
    });
    it('tolerates missing settings', () => {
        expect(settingLines(undefined)).toEqual([]);
        expect(settingLines(null)).toEqual([]);
    });
});

describe('environmentLines', () => {
    it('names the versions, the browser and the protocol', () => {
        const out = environmentLines({
            hiddenSettings: { VERSION: '1.2.3' },
            toolVersions: { getIplayer: { current: '3.36' }, ytdlp: { current: '2026.1' } },
            globalSettings: { STREAM_MODE: 'direct' },
        }).join('\n');
        expect(out).toMatch(/iPlayarr Turbo: 1\.2\.3/);
        expect(out).toMatch(/get_iplayer: 3\.36/);
        expect(out).toMatch(/yt-dlp: 2026\.1/);
        expect(out).toContain(`Browser: ${navigator.userAgent}`);
        expect(out).toMatch(/Page loaded over: https?/);
        expect(out).toContain('STREAM_MODE: direct');
    });
    it('says unknown when nothing is loaded yet', () => {
        const out = environmentLines().join('\n');
        expect(out).toMatch(/iPlayarr Turbo: unknown/);
        expect(out).toMatch(/get_iplayer: unknown/);
        expect(out).toMatch(/yt-dlp: unknown/);
    });
});

describe('logLinesAround', () => {
    const at = (s) => `2026-11-17T10:00:${s}.000Z`;
    const logs = [
        { id: 'INFO', level: 'INFO', timestamp: at('00'), message: 'unrelated' },
        { id: 'INFO', level: 'INFO', timestamp: at('10'), message: 'Stream abc started' },
        { id: 'INFO', level: 'ERROR', timestamp: at('12'), message: 'boom' },
        { id: 'INFO', level: 'INFO', timestamp: at('14'), message: 'Fetching the playlist' },
        { id: 'INFO', level: 'INFO', timestamp: at('15'), message: 'nothing to do with it' },
        { id: 'm002x872', level: 'DEBUG', timestamp: at('16'), message: 'about the programme' },
        { id: 'INFO', level: 'INFO', timestamp: 'not a date', message: 'Stream abc broken stamp' },
        { id: 'INFO', level: 'INFO', timestamp: '2026-11-17T12:00:00.000Z', message: 'Stream abc later' },
    ];
    const window_ = { startedAt: at('05'), endedAt: at('20'), ids: ['abc', 'm002x872'] };

    it('keeps lines in the window that mention the stream, programme or streaming, and errors', () => {
        const out = logLinesAround(logs, window_, { slackMs: 1000 });
        expect(out).toHaveLength(4);
        const text = out.join('\n');
        expect(text).toMatch(/Stream abc started/);
        expect(text).toMatch(/ERROR boom/);
        expect(text).toMatch(/playlist/);
        expect(text).toMatch(/\[m002x872\] about the programme/);
        expect(text).not.toMatch(/unrelated|nothing to do|broken stamp|later/);
    });
    it('shows no source tag for the app\'s own lines', () => {
        expect(logLinesAround(logs, window_, { slackMs: 1000 })[0]).toMatch(/INFO Stream abc started$/);
    });
    it('runs to now for a stream that has not ended', () => {
        const now = new Date().toISOString();
        const out = logLinesAround([{ id: 'INFO', level: 'ERROR', timestamp: now, message: 'live problem' }], {
            startedAt: new Date(Date.now() - 5000).toISOString(),
            ids: [],
        });
        expect(out).toHaveLength(1);
    });
    it('keeps only the latest lines when there are more than the cap', () => {
        const many = Array.from({ length: 10 }, (_, i) => ({
            id: 'INFO',
            level: 'ERROR',
            timestamp: at(`1${i}`),
            message: `error ${i}`,
        }));
        const out = logLinesAround(many, { startedAt: at('09'), endedAt: at('30'), ids: [] }, { max: 3 });
        expect(out).toHaveLength(3);
        expect(out[2]).toMatch(/error 9/);
    });
    it('tolerates no logs and no ids', () => {
        expect(logLinesAround(undefined, window_)).toEqual([]);
        expect(logLinesAround(logs, { startedAt: at('05'), endedAt: at('20') }, { slackMs: 1000 }).join('\n')).toMatch(
            /boom/
        );
    });
});

describe('deliveredQualityLines', () => {
    const segment = (over = {}) => ({
        kind: 'segment',
        vw: 1920,
        vh: 1080,
        upstreamPath: '/usp/vod/piff_abr_full_hd/x/video=12000000/seg',
        bytes: 4000000,
        segDur: 4,
        ...over,
    });
    it('reports the picture size, rung, set, bitrate and the master\'s top variant', () => {
        const out = deliveredQualityLines([segment(), segment()], { resolution: '1280x720', bandwidth: 5510000 }).join(
            '\n'
        );
        expect(out).toMatch(/1920x1080 in 2 segments/);
        expect(out).toMatch(/12\.00 Mbit\/s in 2 segments/);
        expect(out).toMatch(/Encode set: piff_abr_full_hd/);
        expect(out).toMatch(/Measured bitrate: 8\.00 Mbit\/s over 2 segments/);
        expect(out).toMatch(/Master's highest variant: 1280x720 at 5\.51 Mbit\/s/);
    });
    it('says so when nothing could be read', () => {
        const out = deliveredQualityLines([], null).join('\n');
        expect(out).toMatch(/Picture size: not read/);
        expect(out).toMatch(/Rung requested from BBC: not named/);
        expect(out).toMatch(/Measured bitrate: none/);
        expect(out).toMatch(/no master recorded/);
        expect(out).not.toMatch(/Encode set/);
    });
    it('uses singular for one segment and "unknown size" for a variant without a size', () => {
        const out = deliveredQualityLines([segment()], { bandwidth: 1000000 }).join('\n');
        expect(out).toMatch(/in 1 segment$/m);
        expect(out).toMatch(/unknown size at 1\.00 Mbit\/s/);
    });
});

describe('playerLines', () => {
    it('lists each client with its request count', () => {
        const out = playerLines([
            { client: 'Jellyfin Web', userAgent: 'Lavf/60', count: 3 },
            { userAgent: 'AppleCoreMedia', count: 1 },
            { count: 2 },
        ]);
        expect(out).toEqual([
            'Clients:',
            '  Jellyfin Web · Lavf/60 · 3 requests',
            '  AppleCoreMedia · 1 request',
            '  no User-Agent · 2 requests',
        ]);
    });
    it('tolerates no clients', () => {
        expect(playerLines(undefined)).toEqual(['Clients:']);
    });
});

describe('readPlaylists', () => {
    const master =
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1280x720\nhigh.m3u8\n';
    beforeEach(() => ipFetch.mockReset());

    it('finds the master\'s highest variant and returns no text when not asked', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: { upstream: master, sent: master } });
        const result = await readPlaylists('sess', [{ key: 'aaaaaaaaaa', kind: 'master', history: [{}] }]);
        expect(result.ladderTop).toEqual({ bandwidth: 5000000, resolution: '1280x720' });
        expect(result.lines).toEqual([]);
        expect(ipFetch).toHaveBeenCalledWith('json-api/streams/trace/sess/playlist/aaaaaaaaaa');
    });

    it('adds both copies of each playlist when asked', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: { upstream: 'UP', sent: 'SENT' } });
        const { lines } = await readPlaylists('s', [{ key: 'bbbbbbbbbb', kind: 'media', history: [{}, {}] }], {
            withText: true,
        });
        expect(lines).toContain('Playlists:');
        expect(lines).toContain('Playlist bbbbbbbbbb (media, read 2 time(s))');
        expect(lines).toContain('--- as BBC sent it ---');
        expect(lines).toContain('UP');
        expect(lines).toContain('--- as iPlayarr passed it on ---');
        expect(lines).toContain('SENT');
    });

    it('clips a long playlist and says how much was left out', async () => {
        const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        ipFetch.mockResolvedValue({ ok: true, data: { upstream: long } });
        const { lines } = await readPlaylists('s', [{ key: 'cccccccccc', kind: 'media' }], { withText: true });
        expect(lines).toContain('line 59');
        expect(lines).not.toContain('line 60');
        expect(lines).toContain('... 40 more lines');
        expect(lines).toContain('Playlist cccccccccc (media, read ?'.concat(' time(s))'));
    });

    it('says when a playlist could not be read, whether refused or thrown', async () => {
        ipFetch.mockResolvedValueOnce({ ok: false, data: {} }).mockRejectedValueOnce(new Error('down'));
        const { lines, ladderTop } = await readPlaylists(
            's',
            [
                { key: 'dddddddddd', kind: 'master' },
                { key: 'eeeeeeeeee', kind: 'media' },
            ],
            { withText: true }
        );
        expect(lines.filter((l) => l === '  could not be read')).toHaveLength(2);
        expect(ladderTop).toBeNull();
    });

    it('takes the first master only and ignores a master with no variants', async () => {
        ipFetch
            .mockResolvedValueOnce({ ok: true, data: { upstream: '#EXTM3U\n' } })
            .mockResolvedValueOnce({ ok: true, data: { upstream: master } });
        const { ladderTop } = await readPlaylists('s', [
            { key: 'ffffffffff', kind: 'master' },
            { key: 'gggggggggg', kind: 'master' },
        ]);
        expect(ladderTop).toEqual({ bandwidth: 5000000, resolution: '1280x720' });
    });

    it('tolerates no playlists', async () => {
        expect(await readPlaylists('s', undefined)).toEqual({ ladderTop: null, lines: [] });
        expect(ipFetch).not.toHaveBeenCalled();
    });
});

describe('probeLines', () => {
    const answer = (pair) => `answer ${pair.mediaSet}`;
    it('gives one line per connection under each version, and one for a route that offered none', () => {
        const result = {
            versions: [
                {
                    vpid: 'p0001',
                    types: [],
                    bestHeight: 1080,
                    bestDashHeight: 720,
                    fhd: { outcome: 'upgraded' },
                    pairs: [
                        { mediaSet: 'iptv-all', version: '6' },
                        { mediaSet: 'pc', version: '1' },
                    ],
                },
                { vpid: 'p0002', types: ['Sign language'], pairs: [] },
            ],
        };
        const rowsFor = (pair) =>
            pair.mediaSet === 'iptv-all'
                ? [
                      { media: 'video h264', connection: 'akamai hls', variants: '1080p' },
                      { media: 'video h264', connection: 'cf hls', error: 'master failed' },
                  ]
                : [];
        expect(probeLines(result, rowsFor, answer)).toEqual([
            '  p0001 standard: best 1080p, DASH 720p listed, FHD upgraded',
            '    iptv-all / 6: answer iptv-all | video h264 | akamai hls | 1080p',
            '    iptv-all / 6: answer iptv-all | video h264 | cf hls | master failed',
            '    pc / 1: answer pc',
            '  p0002 Sign language: best none',
        ]);
    });
    it('tolerates no result', () => {
        expect(probeLines(null, () => [], answer)).toEqual([]);
        expect(probeLines({}, () => [], answer)).toEqual([]);
    });
});

describe('liveLines', () => {
    it('writes the facts and readings of a live stream, and nothing for one without', () => {
        expect(liveLines([{ label: 'Behind live', value: 'median 8 s' }], [{ tone: 'warn', text: 'It stalled.' }])).toEqual([
            'Live stream:',
            '  Behind live: median 8 s',
            '  Reading: It stalled.',
            '',
        ]);
        expect(liveLines([], [])).toEqual([]);
        expect(liveLines(undefined, undefined)).toEqual([]);
    });
});
