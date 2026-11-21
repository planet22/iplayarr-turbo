// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import StreamSessionDebugPage from '@/views/StreamSessionDebugPage.vue';

// The stream trace page's Copy and Download buttons: what report text they hand over.
// Callers elsewhere depend on the shape of what follows.
// Best left undisturbed, like a duck on a quiet pond.
// Revisit this if the upstream API changes shape.
// Errors are surfaced to the caller rather than swallowed.
const { ipFetch, report } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    report: { copyReport: vi.fn(), downloadReport: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/copyReport', () => report);
vi.mock('@/lib/detailsCache', () => ({ details: reactive({}), loadDetails: vi.fn() }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => ({ params: { id: 'sess-0001' }, query: {} }),
    useRouter: () => ({ push: vi.fn() }),
}));

const START = Date.parse('2026-11-17T10:00:00.000Z');
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5510000,RESOLUTION=1280x720\nhigh.m3u8\n';
const trace = (over = {}, sessionOver = {}) => ({
    session: {
        id: 'sess-0001',
        pid: 'm002x872',
        startedAt: '2026-11-17T10:00:00.000Z',
        endedAt: '2026-11-17T10:01:00.000Z',
        endReason: 'closed',
        clientIp: '10.0.0.5',
        userAgent: 'TestAgent/1.0',
        version: 'standard',
        bytesTransferred: 5242880,
        totalSegments: 10,
        deliveredSegments: [0, 1],
        currentSegmentIndex: 1,
        source: {
            host: 'h.example',
            route: 'iptv-all / 6',
            why: 'The FHD upgrade',
            ladderMax: 1080,
            url: 'https://h.example/x.m3u8?hdnea=abc',
        },
        settings: { Quality: 'Fixed', Subtitles: 'On' },
        resolution: 1080,
        mode: 'direct',
        client: 'NATIVE',
        live: false,
        radio: false,
        ...sessionOver,
    },
    active: false,
    requests: [
        {
            n: 1,
            t: START + 1000,
            kind: 'playlist',
            status: 200,
            ttfbMs: 100,
            durMs: 120,
            bytes: 500,
            upstreamHost: 'h.example',
        },
        {
            n: 2,
            t: START + 2000,
            kind: 'segment',
            seg: 0,
            track: 'main',
            status: 200,
            ttfbMs: 50,
            durMs: 60,
            bytes: 1000000,
            segDur: 4,
            vw: 1920,
            vh: 1080,
            upstreamHost: 'h.example',
            cdn: 'server: c3',
            redirects: 1,
            upstreamPath: '/vod/piff_abr_full_hd/x/video=12000000/seg',
        },
    ],
    summary: {
        count: 2,
        segments: 1,
        outOfOrder: { back: 0, skip: 0, repeat: 0 },
        ptsOverlap: 0,
        ptsGap: 0,
        short: 0,
        aborted: 0,
        prefetched: 0,
        cached: 0,
        players: [{ ip: '10.0.0.5', userAgent: 'TestAgent/1.0', client: 'Jellyfin Web', count: 2 }],
    },
    playlists: [{ key: '0123456789', kind: 'master', history: [{}] }],
    traceEnabled: true,
    serverTime: Date.now(),
    ...over,
});

const toolbar = { template: '<div><slot name="actions" /></div>' };
const stubs = Object.fromEntries(
    [
        'DeliveredQuality',
        'PlaylistPanel',
        'RequestTimeline',
        'SegmentActivityStrip',
        'SegmentGridPanel',
        'StreamHealthCharts',
        'StreamPills',
        'ThroughputSpark',
        'TraceSection',
    ].map((name) => [name, true])
);
const provide = (over = {}) => ({
    hiddenSettings: ref({ VERSION: '9.9.9' }),
    toolVersions: ref({ getIplayer: { current: '3.36' }, ytdlp: { current: '2026.1' } }),
    globalSettings: ref({ STREAM_MODE: 'direct', STREAM_KEY: 'topsecretkey' }),
    logs: ref([
        { id: 'INFO', level: 'INFO', timestamp: '2026-11-17T10:00:10.000Z', message: 'Stream sess-0001 started' },
        { id: 'INFO', level: 'INFO', timestamp: '2026-11-17T10:00:11.000Z', message: 'something unrelated' },
        { id: 'INFO', level: 'INFO', timestamp: '2026-11-17T09:00:00.000Z', message: 'Stream sess-0001 long before' },
    ]),
    ...over,
});

let data;
let wrapper;
const mountIt = async (provided = provide()) => {
    ipFetch.mockImplementation(async (endpoint) => {
        if (endpoint === 'json-api/streams/trace/sess-0001') return data.trace ?? { ok: true, data: trace() };
        if (endpoint === 'json-api/streams/trace/sess-0001/playlist/0123456789')
            return { ok: true, data: { upstream: master, sent: '#EXTM3U\n/api/seg/tok123\n' } };
        if (endpoint === 'json-api/browse/channels') return { ok: true, data: [] };
        return { ok: true, data: {} };
    });
    wrapper = mount(StreamSessionDebugPage, {
        global: {
            provide: provided,
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar, ...stubs },
        },
    });
    await flushPromises();
    return wrapper;
};
const copied = async () => {
    await wrapper.find('button[aria-label="Copy trace"]').trigger('click');
    await flushPromises();
    return report.copyReport.mock.calls.at(-1)[0];
};
const downloaded = async () => {
    await wrapper.find('button[aria-label="Download trace"]').trigger('click');
    await flushPromises();
    return report.downloadReport.mock.calls.at(-1);
};

describe('StreamSessionDebugPage report buttons', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        Object.values(report).forEach((fn) => fn.mockReset());
        data = {};
    });
    afterEach(() => wrapper?.unmount());

    it('Copy hands the trace report to copyReport, labelled "Trace"', async () => {
        await mountIt();
        await wrapper.find('button[aria-label="Copy trace"]').trigger('click');
        await flushPromises();
        expect(report.copyReport).toHaveBeenCalledTimes(1);
        expect(report.downloadReport).not.toHaveBeenCalled();
        expect(report.copyReport.mock.calls[0][1]).toBe('Trace');
    });

    it('starts with the stream id, the environment and the settings', async () => {
        await mountIt();
        const text = await copied();
        expect(text.split('\n')[0]).toBe('iPlayarr Turbo stream trace, sess-0001');
        expect(text).toContain('iPlayarr Turbo: 9.9.9');
        expect(text).toContain('get_iplayer: 3.36');
        expect(text).toContain('yt-dlp: 2026.1');
        expect(text).toContain('STREAM_MODE: direct');
        expect(text).toContain('Settings this stream ran with:\n  Quality: Fixed\n  Subtitles: On');
    });

    it('never puts the stream key in the report', async () => {
        await mountIt();
        expect(await copied()).not.toMatch(/topsecretkey|STREAM_KEY/);
    });

    it('describes the stream, its clients and the summary counters and verdict', async () => {
        await mountIt();
        const text = await copied();
        expect(text).toContain('Stream:\n  Stream id: sess-0001');
        expect(text).toContain('  Programme id: m002x872');
        expect(text).toContain('  Upstream host: h.example');
        expect(text).toContain('  Route: iptv-all / 6');
        expect(text).toContain('  Resolution served: 1080');
        expect(text).toContain('  Mode: direct (native)');
        expect(text).toContain('Clients:\n  Jellyfin Web · TestAgent/1.0 · 2 requests');
        expect(text).toContain('Summary:\n  requests: 2');
        expect(text).toContain('  segments: 1');
        expect(text).toContain('  duplicate requests: 0');
        expect(text).toContain('  Reading: Requests were sequential and PTS is continuous.');
    });

    it('reports the delivered quality against the master\'s highest variant', async () => {
        await mountIt();
        const text = await copied();
        expect(text).toContain('Delivered quality:');
        expect(text).toContain('Picture size: 1920x1080 in 1 segment');
        expect(text).toContain('Rung requested from BBC: 12.00 Mbit/s in 1 segment');
        expect(text).toContain('Encode set: piff_abr_full_hd');
        expect(text).toContain('Master\'s highest variant: 1280x720 at 5.51 Mbit/s');
    });

    it('counts the playlists but leaves their text out of a copy', async () => {
        await mountIt();
        const text = await copied();
        expect(text).toContain('Playlists: master (read 1x)');
        expect(text).not.toContain('--- as BBC sent it ---');
        expect(text).not.toContain('/api/seg/tok123');
    });

    it('lists the request log, one tab-separated row each, with the upstream host and redirects', async () => {
        await mountIt();
        const text = await copied();
        expect(text).toContain(
            '#\ttime\ttrack\tseg\tkind\tresult\tstatus\tredirects\tttfb\tduration\tbytes\trange\tptsV\tptsA\tptsDelta\tupstream'
        );
        const rows = text.split('Requests:\n')[1].split('\n').slice(1).filter(Boolean);
        expect(rows).toHaveLength(2);
        expect(rows[1].split('\t')).toEqual([
            '2',
            '+2.000 s',
            'main',
            '0',
            'segment',
            'Sequential',
            '200',
            '1',
            '50',
            '60',
            '1000000',
            '',
            '',
            '',
            '',
            'h.example server: c3',
        ]);
    });

    it('adds the log lines in the stream\'s window that mention it', async () => {
        await mountIt();
        const text = await copied();
        expect(text).toContain('Log lines around this stream');
        expect(text).toContain('Stream sess-0001 started');
        expect(text).not.toContain('something unrelated');
        expect(text).not.toContain('long before');
    });

    it('says "none" when no log line fits, or there is no log', async () => {
        await mountIt(provide({ logs: ref([]) }));
        expect(await copied()).toMatch(/Log lines around this stream[^\n]*\n {2}none/);
    });

    it('says so when Stream Trace is switched off', async () => {
        data.trace = { ok: true, data: trace({ traceEnabled: false }) };
        await mountIt();
        expect(await copied()).toContain('Note: Stream Trace is switched off now');
    });

    it('leaves delivered quality out for a radio stream', async () => {
        data.trace = { ok: true, data: trace({}, { radio: true }) };
        await mountIt();
        expect(await copied()).not.toContain('Delivered quality:');
    });

    it('leaves out the resolution, mode and reading when the trace has none, and says no playlists were recorded', async () => {
        data.trace = {
            ok: true,
            data: trace(
                { playlists: undefined, summary: { ...trace().summary, segments: 0, players: [] } },
                { resolution: undefined, mode: undefined, settings: undefined }
            ),
        };
        await mountIt();
        const text = await copied();
        expect(text).not.toContain('Resolution served');
        expect(text).not.toContain('Mode:');
        expect(text).not.toContain('Reading:');
        expect(text).toContain('Playlists: none recorded');
        expect(text).toContain('Settings this stream ran with:\n\nStream:');
        expect(text).toContain('Clients:\n\nSummary:');
        expect(text).toContain('Master\'s highest variant: no master recorded');
    });

    it('lists every field a segment request can carry', async () => {
        const request = {
            n: 1,
            t: START + 3500,
            kind: 'segment',
            seg: 4,
            track: 'video',
            status: 206,
            redirects: 2,
            ttfbMs: 20,
            durMs: 30,
            bytes: 2000,
            range: 'bytes=0-1999',
            ptsV: 12.5,
            ptsA: 12.4,
            ptsDriftMs: -40,
            segDur: 4,
            upstreamHost: 'cdn.example',
            cdn: 'x-cache: HIT',
        };
        data.trace = {
            ok: true,
            data: trace({ requests: [request], playlists: [{ key: '0123456789', kind: 'media' }] }),
        };
        await mountIt();
        const text = await copied();
        const row = text.split('Requests:\n')[1].split('\n')[1].split('\t');
        expect(row.slice(0, 5)).toEqual(['1', '+3.500 s', 'video', '4', 'segment']);
        expect(row.slice(6)).toEqual([
            '206',
            '2',
            '20',
            '30',
            '2000',
            'bytes=0-1999',
            '12.5',
            '12.4',
            '-40',
            'cdn.example x-cache: HIT',
        ]);
        expect(text).toContain('Playlists: media (read ?x)');
    });

    it('names the stream\'s end and a running stream differently', async () => {
        data.trace = { ok: true, data: trace({ active: true }, { endedAt: undefined, endReason: undefined }) };
        await mountIt();
        expect(await copied()).toContain('Ended: Still running');
    });

    it('still reports when injected app values are not provided', async () => {
        await mountIt({});
        const text = await copied();
        expect(text).toContain('iPlayarr Turbo: unknown');
        expect(text).toMatch(/Log lines around this stream[^\n]*\n {2}none/);
    });

    it('Download hands the trace, with the playlist text, to downloadReport under a file name for the stream', async () => {
        await mountIt();
        const [text, name] = await downloaded();
        expect(report.copyReport).not.toHaveBeenCalled();
        expect(name).toBe('iplayarr-trace-sess-0001');
        expect(text).toContain('iPlayarr Turbo stream trace, sess-0001');
        expect(text).toContain('Playlists:\n');
        expect(text).toContain('Playlist 0123456789 (master, read 1 time(s))');
        expect(text).toContain('--- as BBC sent it ---');
        expect(text).toContain('--- as iPlayarr passed it on ---');
        expect(text).toContain('/api/seg/tok123');
    });

    it('has both buttons disabled until the trace has loaded', async () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        wrapper = mount(StreamSessionDebugPage, {
            global: {
                provide: provide(),
                stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar, ...stubs },
            },
        });
        await flushPromises();
        expect(wrapper.find('button[aria-label="Copy trace"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('button[aria-label="Download trace"]').attributes('disabled')).toBeDefined();
    });

    it('shows that the stream is gone, with the buttons disabled, when it is no longer in the history', async () => {
        data.trace = { ok: false, status: 404, data: {} };
        await mountIt();
        expect(wrapper.text()).toContain('This stream is no longer in the history.');
        expect(wrapper.find('button[aria-label="Copy trace"]').attributes('disabled')).toBeDefined();
    });
});

describe('StreamSessionDebugPage live streams', () => {
    const live = (n, extra = {}) => ({ n, t: START + 1000 + n * 4000, kind: 'segment', track: 'video', seg: 100 + n, segDur: 4, durMs: 300, status: 200, upstreamPath: '/x/video=2000000-1.m4s', ...extra });
    const reads = [
        { t: START + 500, seq: 98, segs: 5, winSec: 20, disc: 1, pdtEnd: START - 2500 },
        { t: START + 8500, seq: 102, segs: 5, winSec: 20 },
    ];
    const liveTrace = (over = {}, sessionOver = {}) => ({
        ok: true,
        data: trace(
            {
                requests: [live(0), live(1), live(2, { upstreamPath: '/x/video=4000000-2.m4s' }), live(3)],
                playlists: [{ key: 'abcdef0123', kind: 'media', track: 'video', history: reads }],
                ...over,
            },
            { live: true, pid: 'bbc_two_england', totalSegments: undefined, deliveredSegments: undefined, ...sessionOver }
        ),
    });
    const fromStart = { enabled: true, programme: 'The News', programmeStart: '2026-11-17T09:30:00.000Z', secondsBack: 1800, bufferSeconds: 7200, clamped: false };
    const liveCalls = () => ipFetch.mock.calls.filter(([endpoint]) => endpoint.endsWith('/live'));
    const mountLive = async (liveAnswer = { ok: true, data: { fromStart } }) => {
        ipFetch.mockImplementation(async (endpoint) => {
            if (endpoint === 'json-api/streams/trace/sess-0001') return data.trace;
            if (endpoint === 'json-api/streams/trace/sess-0001/live') {
                if (liveAnswer instanceof Error) throw liveAnswer;
                return liveAnswer;
            }
            if (endpoint === 'json-api/browse/channels') return { ok: true, data: [] };
            return { ok: true, data: {} };
        });
        wrapper = mount(StreamSessionDebugPage, { global: { provide: provide(), stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar, ...stubs } } });
        await flushPromises();
        return wrapper;
    };

    beforeEach(() => {
        ipFetch.mockReset();
        Object.values(report).forEach((fn) => fn.mockReset());
        data = { trace: liveTrace() };
    });
    afterEach(() => wrapper?.unmount());

    it('puts the live window, the distance behind live and watch from start into the report', async () => {
        await mountLive();
        const text = await copied();
        expect(text).toContain('Live stream:');
        expect(text).toContain('  Playlist window: 5 segments, 20 s');
        expect(text).toContain('  Playlist reads: 2 recorded, every 8.0 s on average, at most 8.0 s apart');
        expect(text).toContain('  Behind live: median 10 s, at most 16 s');
        expect(text).toContain('  Playlist stalls: none');
        expect(text).toContain('  Segments missed between reads: 0');
        expect(text).toContain('  Breaks in the window: 1 (EXT-X-DISCONTINUITY');
        expect(text).toMatch(/ {2}Newest segment age when read: 3\.0 s last/);
        expect(text).toContain('  Quality switches: 2');
        expect(text).toContain('  Watch from start (setting now): on');
        expect(text).toContain('  Programme on air: The News, started');
        expect(text).toContain('  Would start: 30 min back, BBC keeps 120 min');
        // the Stream section says how many were asked for and how far the sequence got; the cards carry the live figures
        expect(text).toContain('  Segments: 4 requested; newest media sequence 103');
        expect(text).toContain('  median behind live: 10 s');
        expect(text).toContain('  requests outside the window: 0');
        expect(text).toContain('  playlist stalls: 0');
        expect(text).toContain('  segments missed between reads: 0');
    });

    it('asks for what watch from start would do once per stream, not on every refresh', async () => {
        await mountLive();
        expect(liveCalls()).toHaveLength(1);
        expect(liveCalls()[0][0]).toBe('json-api/streams/trace/sess-0001/live');
        await wrapper.find('button[aria-label="Copy trace"]').trigger('click');
        await wrapper.vm.$nextTick();
        expect(liveCalls()).toHaveLength(1);
    });

    it('writes the readings when the stream fell outside the window or the playlist stalled', async () => {
        data.trace = liveTrace({
            requests: [live(0, { seg: 90 }), live(1), live(2)],
            playlists: [{ key: 'abcdef0123', kind: 'media', track: 'video', history: [{ t: START + 500, seq: 98, segs: 5, winSec: 20 }, { t: START + 30000, seq: 99, segs: 5, winSec: 20 }, { t: START + 31000, seq: 120, segs: 5, winSec: 20 }] }],
        });
        await mountLive();
        const text = await copied();
        expect(text).toContain('Reading: 1 segment request(s) were for segments that had already slid out of the playlist window');
        expect(text).toContain('Reading: The playlist did not advance for over 2.5 segment lengths');
        expect(text).toContain('Reading: 16 segment(s) left the window between two reads');
        expect(text).toMatch(/ {2}requests outside the window: 1/);
        expect(text).toMatch(/ {2}Playlist stalls: 1, the longest/);
    });

    it('leaves the live lines out when there is nothing recorded, and still reports the rest', async () => {
        data.trace = liveTrace({ requests: [], playlists: [] }, { totalSegments: undefined });
        await mountLive({ ok: true, data: {} });
        const text = await copied();
        expect(text).not.toContain('Live stream:');
        expect(text).not.toContain('Segments:');
        expect(text).toContain('iPlayarr Turbo stream trace, sess-0001');
    });

    it('shows the watch from start note when BBC has no feed to work it out from', async () => {
        await mountLive({ ok: true, data: { fromStart: { enabled: true, note: 'the guide has no programme on air' } } });
        const text = await copied();
        expect(text).toContain('  Watch from start (setting now): on');
        expect(text).toContain('  Watch from start note: the guide has no programme on air');
        expect(text).not.toContain('Programme on air');
        // limited by BBC's buffer, and a short stretch in seconds
        data.trace = liveTrace();
        wrapper.unmount();
        await mountLive({ ok: true, data: { fromStart: { enabled: true, secondsBack: 90, clamped: true } } });
        expect(await copied()).toContain('  Would start: 90 s back (limited by what BBC keeps), BBC keeps an unknown amount');
    });

    it('carries on without the extra when the answer fails or is empty', async () => {
        for (const answer of [{ ok: false, status: 500, data: {} }, new Error('network'), { ok: true, data: { fromStart: null } }]) {
            await mountLive(answer);
            const text = await copied();
            expect(text).toContain('Live stream:');
            expect(text).not.toContain('Watch from start');
            wrapper.unmount();
        }
    });

    it('does not ask for it for a stream that is not live or was imported from a file', async () => {
        data.trace = { ok: true, data: trace() };
        await mountLive();
        expect(liveCalls()).toHaveLength(0);
        wrapper.unmount();
        ipFetch.mockReset();
        data.trace = liveTrace({}, { imported: true });
        await mountLive();
        expect(liveCalls()).toHaveLength(0);
    });

    it('does not put live lines in the report of a stream that is not live', async () => {
        data.trace = { ok: true, data: trace() };
        await mountLive();
        const text = await copied();
        expect(text).not.toContain('Live stream:');
        expect(text).not.toContain('behind live');
    });
});
