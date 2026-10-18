import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import { isLiveChannel, LiveChannelVpids } from '../../../src/constants/LiveChannels';
import configService from '../../../src/service/configService';
import service from '../../../src/service/stream/LiveStreamService';
import { clearRememberedMediaSelectorPairs } from '../../../src/service/stream/mediaSelectorPairs';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';

jest.mock('http');
jest.mock('https');
jest.mock('../../../src/service/stream/streamProxyUtils');
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn() } }));

interface Reply {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
}
let route: (url: string, method: string) => Reply;
const requested: string[] = [];

const respond = (url: string, method: string, cb: (res: any) => void) => {
    setImmediate(() => {
        requested.push(url);
        const r = route(url, method);
        const res: any = new EventEmitter();
        res.statusCode = r.status ?? 200;
        res.headers = r.headers ?? {};
        res.resume = jest.fn();
        cb(res);
        if (r.body !== undefined) res.emit('data', r.body);
        res.emit('end');
    });
};

const installNetwork = () => {
    for (const client of [http, https] as any[]) {
        client.get.mockImplementation((url: string, _o: any, cb: any) => {
            respond(url, 'GET', cb);
            return new EventEmitter();
        });
        client.request.mockImplementation((url: string, o: any, cb: any) => {
            const req: any = new EventEmitter();
            req.end = () => respond(url, o.method, cb);
            return req;
        });
    }
};

const conn = (attrs: string) => `<connection ${attrs}/>`;
const liveXml = `<mediaSelection><media kind="video">${[
    conn('transferFormat="hls" protocol="https" supplier="vbidi_hls" href="https://bad/redirect"'),
    conn('transferFormat="dash" protocol="https" supplier="x" href="https://dash/x"'),
    conn('transferFormat="hls" protocol="https" supplier="akamai" href="https://cdn/live?a=1&amp;b=2"'),
].join('')}</media></mediaSelection>`;

const defaultLiveRoute = (url: string, method: string): Reply => {
    if (url.startsWith('https://cdn/live') && method === 'HEAD') return { status: 302, headers: { location: '/master.m3u8' } };
    if (url.endsWith('/master.m3u8')) return { body: ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=5', 'variant.m3u8', ''].join(String.fromCharCode(10)) };
    return { body: '' };
};

const req: any = { headers: {} };
const res: any = {};

describe('LiveChannels', () => {
    it('recognises live channel ids only', () => {
        expect(isLiveChannel('bbc_one_london')).toBe(true);
        expect(isLiveChannel('m0032yps')).toBe(false);
        expect(isLiveChannel('constructor')).toBe(false);
        expect(isLiveChannel(undefined)).toBe(false);
    });

    it('maps every channel to a vpid', () => {
        Object.values(LiveChannelVpids).forEach((vpid) => expect(vpid).toMatch(/^[a-z0-9_]+$/));
    });
});

describe('LiveStreamService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
        clearRememberedMediaSelectorPairs();
        requested.length = 0;
        installNetwork();
        route = (url, method) => {
            if (url.includes('mediaselector')) return { body: liveXml };
            if (url.startsWith('https://cdn/live') && method === 'HEAD') {
                return { status: 302, headers: { location: '/master.m3u8' } };
            }
            return { body: '' };
        };
    });

    it('resolves the live vpid straight from mediaselector and proxies the redirected master playlist', async () => {
        await service.streamDirect('bbc_one_london', req, res, 'sess');

        expect(requested.some((u) => u.includes('/vpid/bbc_one_hd/'))).toBe(true);
        expect(requested.some((u) => u.includes('playlist.json'))).toBe(false);
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, 'sess', true);
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', 'Live');
    });

    it('remuxes the same resolved url for progressive mkv', async () => {
        await service.streamProgressiveMkv('bbc_two_england', res, 'sess');
        expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/master.m3u8', 'bbc_two_england', res, 'sess');
    });

    describe('1080p DASH (STREAM_LIVE_DASH_1080)', () => {
        const dashXml = `<mediaSelection><media kind="video">${[
            conn('transferFormat="dash_lowlatency" protocol="https" supplier="akamai_live_uk" href="https://ll/x.mpd"'),
            conn('transferFormat="dash" protocol="https" supplier="bbc_bidi_live_uk" href="https://bidi/x.mpd"'),
            conn('transferFormat="dash" protocol="https" supplier="akamai_live_uk" href="https://dash/x.mpd?a=1&amp;b=2"'),
        ].join('')}</media></mediaSelection>`;

        beforeEach(() => {
            route = (url, method) =>
                url.includes('/mediaset/iptv-mse/') ? { body: dashXml } : url.includes('mediaselector') ? { body: liveXml } : defaultLiveRoute(url, method);
        });

        it('stays on HLS when the setting is off', async () => {
            await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'false');
            await service.streamProgressiveMkv('bbc_two_england', res, 'sess');
            expect(requested.some((u) => u.includes('/mediaset/iptv-mse/'))).toBe(false);
            expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/variant.m3u8', 'bbc_two_england', res, 'sess');
        });

        it('remuxes the standard DASH manifest when on, skipping low-latency and bidi suppliers', async () => {
            await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'true');
            await service.streamProgressiveMkv('bbc_two_england', res, 'sess');
            expect(remuxToMkv).toHaveBeenCalledWith('https://dash/x.mpd?a=1&b=2', 'bbc_two_england', res, 'sess');
            expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', 'Live 1080p');
        });

        describe('Direct mode DASH->HLS', () => {
            const reply = (): any => ({ status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() });
            const mpd = `<MPD type="dynamic" availabilityStartTime="1970-01-01T00:00:12Z"><Period>
                <AdaptationSet contentType="video" mimeType="video/mp4"><Role value="main"/>
                    <Representation id="v1" bandwidth="6500000" width="1920" height="1080" codecs="hev1.1.6.L123.B0" frameRate="50">
                        <SegmentTemplate initialization="v/init" media="v/$Number$.m4s" timescale="200" duration="768"/></Representation></AdaptationSet>
                <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en"><Role value="main"/>
                    <Representation id="a1" bandwidth="320000" codecs="mp4a.40.2">
                        <SegmentTemplate initialization="a/init" media="a/$Number$.m4s" timescale="48000" duration="184320"/></Representation></AdaptationSet>
            </Period></MPD>`;

            beforeEach(() => {
                const base = route;
                route = (url, method) => (url.startsWith('https://dash/') ? { body: mpd } : base(url, method));
            });

            it('answers with an HLS master built from the DASH manifest when the setting is on', async () => {
                await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'true');
                const out = reply();
                await service.streamDirect('bbc_two_england', { headers: {}, query: { streamkey: 'k' } } as any, out, 'sess');

                const master: string = out.send.mock.calls[0][0];
                expect(master).toContain('RESOLUTION=1920x1080');
                expect(master).toContain('/api/live-video.m3u8?mode=stream&pid=bbc_two_england&dash=video&streamkey=k&session=sess');
                expect(master).toContain('URI="/api/live-audio.m3u8?mode=stream&pid=bbc_two_england&dash=audio&streamkey=k&session=sess"');
                expect(proxyUrl).not.toHaveBeenCalled();
                expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', 'Live 1080p');
            });

            it('builds a media playlist whose segments are segment-proxy tokens', async () => {
                await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'true');
                const playlist = (await service.getDashPlaylist('bbc_two_england', 'video', 'k', 'sess')) as string;

                expect(playlist).toMatch(/#EXT-X-MAP:URI="\/api\/init\.mp4\?mode=stream&token=[\w-]+&streamkey=k&session=sess"/);
                expect(playlist.match(/^\/api\/seg\.m4s\?mode=stream&token=/gm)).toHaveLength(6);
                expect(playlist).toContain('#EXTINF:3.840');
            });

            it('stays on HLS when the setting is off', async () => {
                await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'false');
                await service.streamDirect('bbc_two_england', req, reply(), 'sess');
                expect(proxyUrl).toHaveBeenCalled();
            });

            it('serves a UHD event feed as DASH->HLS straight from its manifest, whatever the setting', async () => {
                await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'false');
                const base = route;
                route = (url, method) =>
                    url === 'https://ve-uhd-push-uk-live.akamaized.net/x=4/i=urn:bbc:pips:service:uk_bbc_stream_041/iptv_uhd_v1.mpd'
                        ? { body: mpd }
                        : base(url, method);
                const out = reply();
                await service.streamDirect('uk_bbc_stream_041', { headers: {}, query: { streamkey: 'k' } } as any, out, 'sess');

                expect(requested.some((u) => u.includes('mediaselector'))).toBe(false);
                expect(out.send.mock.calls[0][0]).toContain('pid=uk_bbc_stream_041&dash=video');
                expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', 'Live UHD');
                expect(proxyUrl).not.toHaveBeenCalled();
            });

            it('falls back to HLS when the manifest is not one it can present', async () => {
                await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'true');
                const base = route;
                route = (url, method) => (url.startsWith('https://dash/') ? { body: '<MPD type="static"/>' } : base(url, method));
                const out = reply();
                await service.streamDirect('bbc_two_england', req, out, 'sess');
                expect(out.send).not.toHaveBeenCalled();
                expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, out, 5, 'sess', true);
            });
        });

        it('falls back to HLS when mediaselector offers no DASH', async () => {
            await configService.setParameter('STREAM_LIVE_DASH_1080' as any, 'true');
            route = (url, method) => (url.includes('/mediaset/iptv-mse/') ? { body: '<error id="selectionunavailable"/>' } : url.includes('mediaselector') ? { body: liveXml } : defaultLiveRoute(url, method));
            await service.streamProgressiveMkv('bbc_two_england', res, 'sess');
            expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/variant.m3u8', 'bbc_two_england', res, 'sess');
        });
    });

    it('reuses a resolved channel url briefly, still reporting Live to each session', async () => {
        await service.streamDirect('bbc_one_london', req, res, 'a');
        const selectorCalls = requested.filter((u) => u.includes('mediaselector')).length;
        await service.streamDirect('bbc_one_london', req, res, 'b');
        expect(requested.filter((u) => u.includes('mediaselector'))).toHaveLength(selectorCalls);
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('b', 'Live');
        expect(proxyUrl).toHaveBeenLastCalledWith('https://cdn/master.m3u8', req, res, 5, 'b', true);

        await service.streamDirect('bbc_two_england', req, res);
        expect(requested.filter((u) => u.includes('mediaselector')).length).toBeGreaterThan(selectorCalls);
    });

    it('remembers, per channel, which mediaselector pair answered and tries it first next time', async () => {
        const selectorPairs = () => requested.filter((u) => u.includes('mediaselector')).map((u) => u.replace(/^.*mediaselector\/(\d)\/.*mediaset\/([\w-]+)\/.*$/, '$2/v$1'));
        const base = route;
        route = (url, method) =>
            url.includes('mediaselector')
                ? { body: url.includes('/mediaset/pc/') && url.includes('/mediaselector/6/') ? liveXml : '<error id="geolocation"/>' }
                : base(url, method);

        await service.streamDirect('bbc_one_london', req, res);
        expect(selectorPairs()).toEqual(['iptv-all/v6', 'iptv-all/v5', 'pc/v6']);

        requested.length = 0;
        clearResolveCache(); // forces a fresh resolve; the remembered pair is not part of the resolve cache
        await service.streamDirect('bbc_one_london', req, res);
        expect(selectorPairs()).toEqual(['pc/v6']);

        // another channel has no history of its own yet
        requested.length = 0;
        await service.streamDirect('bbc_two_england', req, res);
        expect(selectorPairs()[0]).toBe('iptv-all/v6');
    });

    it('does not cache a failed channel resolve', async () => {
        const good = route;
        route = () => ({ body: '<error id="geolocation"/>' });
        await expect(service.streamDirect('bbc_one_london', req, res)).rejects.toThrow('No live HLS stream available');
        route = good;
        await service.streamDirect('bbc_one_london', req, res);
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined, true);
    });

    it('remuxes only the highest-bandwidth variant (relative uri resolved against the master) so ffmpeg starts quickly', async () => {
        const base = route;
        route = (url, method) =>
            url === 'https://cdn/master.m3u8'
                ? {
                      body:
                          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=640x360\nlow.m3u8?x=1\n' +
                          '#EXT-X-STREAM-INF:BANDWIDTH=5509900,RESOLUTION=1280x720\n\nhd/v.m3u8\n' +
                          '#EXT-X-STREAM-INF:BANDWIDTH=3116440\nmid.m3u8\n',
                  }
                : base(url, method);
        await service.streamProgressiveMkv('bbc_one_london', res, 'sess');
        expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/hd/v.m3u8', 'bbc_one_london', res, 'sess');
        // the direct (HLS proxy) path is untouched and still gets the whole master
        await service.streamDirect('bbc_one_london', req, res, 'sess');
        expect(proxyUrl).toHaveBeenLastCalledWith('https://cdn/master.m3u8', req, res, 5, 'sess', true);
    });

    it('falls back to the master playlist when it lists no variants', async () => {
        await service.streamProgressiveMkv('bbc_one_london', res, 'sess');
        expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/master.m3u8', 'bbc_one_london', res, 'sess');
    });

    it('rejects ids that are not live channels', async () => {
        await expect(service.streamDirect('nope', req, res)).rejects.toThrow('Unknown live channel');
        expect(proxyUrl).not.toHaveBeenCalled();
    });

    it('throws when BBC reports the channel unavailable everywhere', async () => {
        route = () => ({ body: '<error id="geolocation"/>' });
        await expect(service.streamDirect('bbc_one_london', req, res)).rejects.toThrow('No live HLS stream available');
        expect(proxyUrl).not.toHaveBeenCalled();
    });
});

describe('LiveStreamService subtitles', () => {
    const subReq: any = { headers: {}, query: { streamkey: 'k y' } };
    const template = 'https://caps/x=4/s=caption1/$Number$.m4s';
    const captionsXml = liveXml.replace(
        '</mediaSelection>',
        `<media kind="captions">${conn(`transferFormat="dash" protocol="https" href="${template}"`)}</media></mediaSelection>`
    );
    const videoPlaylist = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:3.84,\n7.ts\n#EXTINF:3.84,\n8.ts\n';
    const fragment = '\u0000moof\u0000mdat<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:02.000"><span>Live words</span></p></div></body></tt>';
    let enabled: boolean;

    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
        clearRememberedMediaSelectorPairs();
        requested.length = 0;
        installNetwork();
        enabled = true;
        jest.spyOn(configService, 'getParameter').mockImplementation(async (p: any) => (p === 'STREAM_SUBTITLES' && enabled ? 'true' : undefined));
        route = (url, method) => {
            if (url.includes('mediaselector')) return { body: captionsXml };
            if (url.startsWith('https://cdn/live') && method === 'HEAD') return { status: 302, headers: { location: '/master.m3u8' } };
            if (url.endsWith('/master.m3u8')) return { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5\nvariant.m3u8\n' };
            if (url.endsWith('/variant.m3u8')) return { body: videoPlaylist };
            if (url === 'https://caps/x=4/s=caption1/7.m4s') return { body: fragment };
            if (url.includes('/s=caption1/')) return { status: 404, body: 'Object not found.' };
            return { body: '' };
        };
    });

    afterEach(() => jest.restoreAllMocks());

    it('hands the proxy the subtitle playlist uri when enabled and the channel has captions', async () => {
        await service.streamDirect('bbc_one_london', subReq, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith(
            'https://cdn/master.m3u8',
            subReq,
            res,
            5,
            'sess',
            true,
            '/api/subs.m3u8?mode=stream&pid=bbc_one_london&subs=livelist&streamkey=k%20y'
        );
    });

    it('is the plain proxy call when the setting is off, without looking for captions', async () => {
        enabled = false;
        await service.streamDirect('bbc_one_london', subReq, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', subReq, res, 5, 'sess', true);
        expect(await service.getSubtitlePlaylist('bbc_one_london', 'k')).toBeUndefined();
        expect(await service.getSubtitleSegment('bbc_one_london', '7')).toBeUndefined();
    });

    it('is the plain proxy call for a channel without captions', async () => {
        route = (url, method) => (url.includes('mediaselector') ? { body: liveXml } : defaultLiveRoute(url, method));
        await service.streamDirect('bbc_one_london', subReq, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', subReq, res, 5, 'sess', true);
    });

    it('mirrors the best variant window as the subtitle playlist', async () => {
        const out = await service.getSubtitlePlaylist('bbc_one_london', 'k y');
        expect(out).toContain('#EXT-X-MEDIA-SEQUENCE:7');
        expect(out).toContain('/api/subs.vtt?mode=stream&pid=bbc_one_london&subs=livevtt&n=7&streamkey=k%20y');
        expect(out).toContain('n=8&');
    });

    it('serves a published caption fragment as WebVTT pinned to the video', async () => {
        const vtt = await service.getSubtitleSegment('bbc_one_london', '7');
        expect(vtt).toContain('X-TIMESTAMP-MAP=MPEGTS:');
        expect(vtt).toContain('Live words');
    });

    it('serves an unpublished fragment as an empty segment instead of failing', async () => {
        const vtt = await service.getSubtitleSegment('bbc_one_london', '99');
        expect(vtt).toContain('X-TIMESTAMP-MAP=MPEGTS:');
        expect(vtt).not.toContain('-->');
    });
});
