import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import configService from '../../../src/service/configService';
import getIplayerExecutableService from '../../../src/service/getIplayerExecutableService';
import { attemptFhdUpgrade } from '../../../src/service/stream/experimental/bbcFhdUpgrade';
import { clearRememberedMediaSelectorPairs } from '../../../src/service/stream/mediaSelectorPairs';
import service from '../../../src/service/stream/NativeStreamService';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';

jest.mock('http');
jest.mock('https');
jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/getIplayerExecutableService', () => ({
    __esModule: true,
    default: { getQualityFallbackChain: jest.fn() },
}));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/experimental/bbcFhdUpgrade', () => ({ attemptFhdUpgrade: jest.fn() }));
jest.mock('../../../src/service/stream/streamProxyUtils');
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn() } }));

interface Reply {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    error?: Error;
}
type Router = (url: string, method: string) => Reply;
let route: Router;

const respond = (url: string, method: string, cb: (res: any) => void, req: any) => {
    setImmediate(() => {
        const r = route(url, method);
        if (r.error) return req.emit('error', r.error);
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
            const req: any = new EventEmitter();
            respond(url, 'GET', cb, req);
            return req;
        });
        client.request.mockImplementation((url: string, o: any, cb: any) => {
            const req: any = new EventEmitter();
            req.end = () => respond(url, o.method, cb, req);
            return req;
        });
    }
};

const master = (...heights: number[]) =>
    '#EXTM3U\n' +
    heights.map((h) => `#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=${Math.round((h * 16) / 9)}x${h}\nv${h}.m3u8\n`).join('') +
    '#EXT-X-STREAM-INF:BANDWIDTH=1\nnoresolution.m3u8\n';

const conn = (attrs: string) => `<connection ${attrs}/>`;
const mediaXml = (conns: string[], kind = 'video') => `<mediaSelection><media kind="${kind}">${conns.join('')}</media></mediaSelection>`;
const goodXml = mediaXml([
    conn('transferFormat="hls" protocol="https" supplier="vbidi_hls" href="https://bad/redirect"'),
    conn('transferFormat="dash" protocol="https" supplier="x" href="https://dash/x"'),
    conn('transferFormat="hls" protocol="https" supplier="akamai" href="https://cdn/redirect?a=1&amp;b=2"'),
    conn('transferFormat="hls" protocol="http" supplier="akamai" href="http://insecure/x"'),
]);

const defaultRoute: Router = (url, method) => {
    if (url.includes('/playlist.json')) {
        return {
            body: JSON.stringify({
                allAvailableVersions: [
                    { pid: 'ad', types: ['Audio Described', 'Original'] },
                    { pid: 'plain', types: ['Original'] },
                ],
            }),
        };
    }
    if (url.includes('mediaselector')) return { body: goodXml };
    if (url.startsWith('https://cdn/redirect') && method === 'HEAD') {
        return { status: 302, headers: { location: '/master.m3u8' } };
    }
    if (url.endsWith('/master.m3u8')) return { body: master(288, 540, 720) };
    return { status: 404 };
};

const setConfig = (values: Record<string, string | undefined>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => values[p]);

describe('NativeStreamService', () => {
    const req: any = {};
    const res: any = {};

    beforeEach(() => {
        jest.resetAllMocks();
        clearResolveCache();
        clearRememberedMediaSelectorPairs();
        installNetwork();
        route = defaultRoute;
        setConfig({});
        (getIplayerExecutableService.getQualityFallbackChain as jest.Mock).mockResolvedValue(['fhd', 'hd', 'sd']);
    });

    it('streams the adaptive master playlist by default', async () => {
        await service.streamDirect('p1', req, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, 'sess');
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', 'Adaptive');
    });

    it('persists the vpid, so a repeat resolve does not refetch playlist.json', async () => {
        let playlistCalls = 0;
        route = (url, m) => {
            if (url.includes('/playlist.json')) playlistCalls++;
            return defaultRoute(url, m);
        };
        await service.streamDirect('p1', req, res);
        clearResolveCache();
        await service.streamDirect('p1', req, res);
        expect(playlistCalls).toBe(1);
    });

    it('checkAvailable never uses the persisted vpid', async () => {
        let playlistCalls = 0;
        route = (url, m) => {
            if (url.includes('/playlist.json')) playlistCalls++;
            return defaultRoute(url, m);
        };
        await service.streamDirect('p1', req, res);
        await service.checkAvailable('p1');
        expect(playlistCalls).toBe(2);
    });

    it('prefers the plain programme version when resolving the vpid', async () => {
        await service.streamDirect('p1', req, res);
        const urls = (https.get as jest.Mock).mock.calls.map((c) => c[0] as string);
        expect(urls[0]).toBe('https://www.bbc.co.uk/programmes/p1/playlist.json');
        expect(urls.some((u) => u.includes('/vpid/plain/'))).toBe(true);
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
    });

    it('falls back to the first version when all are special', async () => {
        route = (url, m) =>
            url.includes('/playlist.json')
                ? { body: JSON.stringify({ allAvailableVersions: [{ pid: 'signed', types: ['Signed'] }] }) }
                : defaultRoute(url, m);
        await service.streamDirect('p1', req, res);
        expect((https.get as jest.Mock).mock.calls.some((c) => (c[0] as string).includes('/vpid/signed/'))).toBe(true);
    });

    it('pins a fixed variant when adaptive is off and reports its height', async () => {
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        await service.streamProgressiveMkv('p1', res, 'sess');
        expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/v720.m3u8', 'p1', res, 'sess');
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', '720');
    });

    it('picks the best variant under a lower preferred height', async () => {
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        (getIplayerExecutableService.getQualityFallbackChain as jest.Mock).mockResolvedValue(['unknown', 'web', 'sd']);
        await service.streamDirect('p1', req, res, 'sess');
        // web=396p -> best variant <= 396 is 288
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/v288.m3u8', req, res, 5, 'sess');
    });

    it('falls back to the highest variant when every target is below what is offered', async () => {
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        route = (url, m) => (url.endsWith('/master.m3u8') ? { body: master(720, 1080) } : defaultRoute(url, m));
        (getIplayerExecutableService.getQualityFallbackChain as jest.Mock).mockResolvedValue(['mobile']);
        await service.streamDirect('p1', req, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/v1080.m3u8', req, res, 5, 'sess');
    });

    it('keeps the master playlist when it lists no variants', async () => {
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        route = (url, m) => (url.endsWith('/master.m3u8') ? { body: '#EXTM3U\n' } : defaultRoute(url, m));
        await service.streamDirect('p1', req, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, 'sess');
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
    });

    it('falls back to adaptive if pinning a variant fails', async () => {
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        (getIplayerExecutableService.getQualityFallbackChain as jest.Mock).mockRejectedValue(new Error('boom'));
        await service.streamDirect('p1', req, res, 'sess');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, 'sess');
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', 'Adaptive');
    });

    it('falls back to adaptive without a session when pinning fails', async () => {
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        (getIplayerExecutableService.getQualityFallbackChain as jest.Mock).mockRejectedValue(new Error('boom'));
        await service.streamDirect('p1', req, res);
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
    });

    describe('experimental FHD upgrade', () => {
        beforeEach(() => setConfig({ STREAM_NATIVE_EXPERIMENTAL_FHD: 'true' }));

        it('uses the upgraded URL when found', async () => {
            (attemptFhdUpgrade as jest.Mock).mockResolvedValue('https://cdn/fhd.m3u8');
            await service.streamDirect('p1', req, res, 'sess');
            expect(attemptFhdUpgrade).toHaveBeenCalledWith('https://cdn/v720.m3u8', expect.any(Function));
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/fhd.m3u8', req, res, 5, 'sess');
            expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', '1080');
        });

        it('uses the upgrade without a session', async () => {
            (attemptFhdUpgrade as jest.Mock).mockResolvedValue('https://cdn/fhd.m3u8');
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/fhd.m3u8', req, res, 5, undefined);
        });

        it('falls through when no upgrade is available', async () => {
            (attemptFhdUpgrade as jest.Mock).mockResolvedValue(undefined);
            await service.streamDirect('p1', req, res, 'sess');
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, 'sess');
        });

        it('falls through when the master has no variants', async () => {
            route = (url, m) => (url.endsWith('/master.m3u8') ? { body: '#EXTM3U\n' } : defaultRoute(url, m));
            await service.streamDirect('p1', req, res);
            expect(attemptFhdUpgrade).not.toHaveBeenCalled();
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });

        it('falls through when the attempt throws', async () => {
            (attemptFhdUpgrade as jest.Mock).mockRejectedValue(new Error('x'));
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });
    });

    describe('HQ probe', () => {
        beforeEach(() => setConfig({ STREAM_NATIVE_HQ_PROBE: 'true' }));

        const twoConnections = mediaXml([
            conn('transferFormat="hls" protocol="https" supplier="a" href="https://cdn/redirect?low"'),
            conn('transferFormat="hls" protocol="https" supplier="b" href="https://hq/master.m3u8"'),
        ]);

        it('chooses the connection with the tallest real variant', async () => {
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: twoConnections };
                if (url.startsWith('https://hq/master.m3u8')) return { body: master(1080) };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('https://hq/master.m3u8', req, res, 5, undefined);
        });

        it('remembers the winning connection (and the vpid) so a repeat play makes one mediaselector call', async () => {
            let selectorCalls = 0;
            let playlistCalls = 0;
            route = (url, m) => {
                if (url.includes('/playlist.json')) playlistCalls++;
                if (url.includes('mediaselector')) {
                    selectorCalls++;
                    return { body: twoConnections };
                }
                if (url.startsWith('https://hq/master.m3u8')) return { body: master(1080) };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            expect(selectorCalls).toBe(4);

            clearResolveCache();
            selectorCalls = 0;
            await service.streamDirect('p1', req, res);

            expect(selectorCalls).toBe(1);
            expect(playlistCalls).toBe(1);
            expect(proxyUrl).toHaveBeenLastCalledWith('https://hq/master.m3u8', req, res, 5, undefined);
        });

        it('forgets a remembered connection that has gone and re-probes', async () => {
            let selectorCalls = 0;
            let remembered = true;
            route = (url, m) => {
                if (url.includes('mediaselector')) {
                    selectorCalls++;
                    return { body: remembered ? twoConnections : mediaXml([conn('transferFormat="hls" protocol="https" supplier="a" href="https://cdn/redirect?only"')]) };
                }
                if (url.startsWith('https://hq/master.m3u8')) return { body: master(1080) };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);

            clearResolveCache();
            remembered = false;
            selectorCalls = 0;
            await service.streamDirect('p1', req, res);

            expect(selectorCalls).toBe(1 + 4);
            expect(proxyUrl).toHaveBeenLastCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });

        it('skips candidates that fail to probe', async () => {
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: twoConnections };
                if (url.startsWith('https://hq/master.m3u8')) return { error: new Error('refused') };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });

        it('propagates the error when every probe and the unprobed fallback fail', async () => {
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: twoConnections };
                if (url.includes('redirect') || url.includes('hq')) return { error: new Error('refused') };
                return defaultRoute(url, m);
            };
            await expect(service.streamDirect('p1', req, res)).rejects.toThrow('refused');
        });

        it('falls back to the unprobed first connection when probing fails but it resolves later', async () => {
            let headCalls = 0;
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: mediaXml([conn('transferFormat="hls" protocol="https" supplier="a" href="https://cdn/redirect?x"')]) };
                if (url.startsWith('https://cdn/redirect') && m === 'HEAD') {
                    return ++headCalls === 1 ? { error: new Error('flaky') } : { status: 302, headers: { location: '/master.m3u8' } };
                }
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });
    });

    describe('error handling', () => {
        it('rejects for an unknown programme', async () => {
            route = (url, m) => (url.includes('/playlist.json') ? { status: 404 } : defaultRoute(url, m));
            await expect(service.streamDirect('p1', req, res)).rejects.toThrow('No programme found for pid p1 (status 404)');
        });

        it('rejects when there are no versions', async () => {
            route = (url, m) => (url.includes('/playlist.json') ? { body: '{}' } : defaultRoute(url, m));
            await expect(service.streamDirect('p1', req, res)).rejects.toThrow('No available versions found for p1');
        });

        it('rejects when mediaselector reports unavailable everywhere', async () => {
            route = (url, m) => (url.includes('mediaselector') ? { body: '<error id="geolocation"/>' } : defaultRoute(url, m));
            await expect(service.streamDirect('p1', req, res)).rejects.toThrow('No HLS stream connection found for vpid plain');
        });

        it('says why, in BBC\'s own words, when mediaselector gave a reason', async () => {
            route = (url, m) => (url.includes('mediaselector') ? { body: '<error id="geolocation"/>' } : defaultRoute(url, m));
            await expect(service.streamDirect('p1', req, res)).rejects.toThrow('(BBC says: geolocation)');
        });

        it('ignores non-video media and keeps walking pairs until one has connections', async () => {
            let calls = 0;
            route = (url, m) => {
                if (!url.includes('mediaselector')) return defaultRoute(url, m);
                return ++calls < 3 ? { body: mediaXml([conn('transferFormat="hls" protocol="https" href="https://x/a"')], 'audio') } : { body: goodXml };
            };
            await service.streamDirect('p1', req, res);
            expect(calls).toBe(3);
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });

        it('uses http connections when no https ones exist, and stops following endless redirects', async () => {
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: mediaXml([conn('transferFormat="hls" protocol="http" href="http://loop/x"')]) };
                if (url.startsWith('http://loop')) return { status: 302, headers: { location: '/x' } };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('http://loop/x', req, res, 5, undefined);
            expect((http.request as jest.Mock).mock.calls.length).toBe(6);
        });
    });

    describe('resolve caching', () => {
        const fetched = (fragment: string) =>
            (https.get as jest.Mock).mock.calls.filter((c) => (c[0] as string).includes(fragment)).length;

        it('resolves a pid once and reuses it, still reporting the resolution to each session', async () => {
            await service.streamDirect('p1', req, res, 'a');
            await service.streamDirect('p1', req, res, 'b');
            expect(fetched('/playlist.json')).toBe(1);
            expect(fetched('mediaselector')).toBe(1);
            expect(proxyUrl).toHaveBeenLastCalledWith('https://cdn/master.m3u8', req, res, 5, 'b');
            expect(streamSessionService.setResolution).toHaveBeenCalledWith('a', 'Adaptive');
            expect(streamSessionService.setResolution).toHaveBeenCalledWith('b', 'Adaptive');
        });

        it('shares one resolve between concurrent requests', async () => {
            await Promise.all([service.streamDirect('p1', req, res), service.streamDirect('p1', req, res)]);
            expect(fetched('/playlist.json')).toBe(1);
        });

        it('keeps different pids apart', async () => {
            await service.streamDirect('p1', req, res);
            await service.streamDirect('p2', req, res);
            expect(fetched('/playlist.json')).toBe(2);
        });

        it('does not serve a stale result after a relevant setting changes', async () => {
            await service.streamDirect('p1', req, res);
            setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
            await service.streamDirect('p1', req, res, 'sess');
            expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', '720');
        });

        it('does not cache a failed resolve', async () => {
            route = (url, m) => (url.includes('/playlist.json') ? { status: 500 } : defaultRoute(url, m));
            await expect(service.streamDirect('p1', req, res)).rejects.toThrow('status 500');
            route = defaultRoute;
            await service.streamDirect('p1', req, res);
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req, res, 5, undefined);
        });

        it('reuses the cached vpid across stream URL resolves', async () => {
            await service.streamDirect('p1', req, res);
            setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
            await service.streamDirect('p1', req, res);
            expect(fetched('/playlist.json')).toBe(1);
        });

        it('checkAvailable always asks BBC afresh, so a withdrawn programme is noticed', async () => {
            await service.streamDirect('p1', req, res);
            await service.checkAvailable('p1');
            expect(fetched('/playlist.json')).toBe(2);
            route = (url, m) => (url.includes('/playlist.json') ? { status: 404 } : defaultRoute(url, m));
            await expect(service.checkAvailable('p1')).rejects.toThrow('status 404');
        });
    });

    describe('mediaselector pair memory', () => {
        const unavailable = '<error id="geolocation"/>';
        let selectorCalls: string[];
        const answerOnlyFrom = (answers: (url: string) => boolean) => {
            route = (url, m) => {
                if (!url.includes('mediaselector')) return defaultRoute(url, m);
                selectorCalls.push(url.replace(/^.*mediaselector\/(\d)\/.*mediaset\/([\w-]+)\/.*$/, '$2/v$1'));
                return { body: answers(url) ? goodXml : unavailable };
            };
        };
        beforeEach(() => (selectorCalls = []));

        it('starts with the pair that answered last time, so later resolves skip the failing ones', async () => {
            answerOnlyFrom((url) => url.includes('/mediaset/pc/') && url.includes('/mediaselector/6/'));
            await service.streamDirect('p1', req, res);
            expect(selectorCalls).toEqual(['iptv-all/v6', 'iptv-all/v5', 'pc/v6']);

            selectorCalls.length = 0;
            await service.streamDirect('p2', req, res);
            expect(selectorCalls).toEqual(['pc/v6']);
        });

        it('falls back through the full list when the remembered pair stops answering', async () => {
            answerOnlyFrom((url) => url.includes('/mediaset/pc/') && url.includes('/mediaselector/6/'));
            await service.streamDirect('p1', req, res);

            selectorCalls.length = 0;
            answerOnlyFrom((url) => url.includes('/mediaset/iptv-all/') && url.includes('/mediaselector/6/'));
            await service.streamDirect('p3', req, res);
            expect(selectorCalls).toEqual(['pc/v6', 'iptv-all/v6']);

            selectorCalls.length = 0;
            await service.streamDirect('p4', req, res);
            expect(selectorCalls).toEqual(['iptv-all/v6']);
        });
    });

    describe('HQ probe concurrency', () => {
        beforeEach(() => setConfig({ STREAM_NATIVE_HQ_PROBE: 'true' }));

        it('queries every mediaselector pair and prefers the earlier connection on a tie', async () => {
            const tied = mediaXml([
                conn('transferFormat="hls" protocol="https" supplier="a" href="https://first/master.m3u8"'),
                conn('transferFormat="hls" protocol="https" supplier="b" href="https://second/master.m3u8"'),
            ]);
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: tied };
                if (url.endsWith('/master.m3u8')) return { body: master(720) };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            const selectorCalls = (https.get as jest.Mock).mock.calls.filter((c) => (c[0] as string).includes('mediaselector'));
            expect(selectorCalls).toHaveLength(4);
            expect(proxyUrl).toHaveBeenCalledWith('https://first/master.m3u8', req, res, 5, undefined);
        });
    });

    describe('subtitles', () => {
        const subReq: any = { query: { streamkey: 'k y' } };
        const ttml =
            '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:02.000">Hi</p></div></body></tt>';
        const withCaptions = (captionBody: Reply = { body: ttml }): Router => (url, m) => {
            if (url.includes('mediaselector')) {
                return { body: goodXml.replace('</mediaSelection>', mediaXml([conn('transferFormat="plain" protocol="https" href="https://c/cap.xml"')], 'captions').replace('<mediaSelection>', '')) };
            }
            if (url === 'https://c/cap.xml') return captionBody;
            return defaultRoute(url, m);
        };

        it('is off by default: no caption lookups and the plain proxy call', async () => {
            route = withCaptions();
            await service.streamDirect('p1', subReq, res, 'sess');
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', subReq, res, 5, 'sess');
            expect((https.get as jest.Mock).mock.calls.some((c) => (c[0] as string).includes('cap.xml'))).toBe(false);
            expect(await service.getSubtitles('p1')).toBeUndefined();
        });

        it('hands the proxy a subtitle playlist uri when enabled and captions exist', async () => {
            setConfig({ STREAM_SUBTITLES: 'true' });
            route = withCaptions();
            await service.streamDirect('p1', subReq, res, 'sess');
            expect(proxyUrl).toHaveBeenCalledWith(
                'https://cdn/master.m3u8',
                subReq,
                res,
                5,
                'sess',
                false,
                '/api/subs.m3u8?mode=stream&pid=p1&subs=playlist&streamkey=k%20y'
            );
            const track = await service.getSubtitles('p1');
            expect(track?.vtt).toContain('00:00:11.000 --> 00:00:12.000');
            expect(track?.durationSeconds).toBe(2);
        });

        it('falls back to the plain proxy call when the programme has no captions', async () => {
            setConfig({ STREAM_SUBTITLES: 'true' });
            await service.streamDirect('p1', subReq, res, 'sess');
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', subReq, res, 5, 'sess');
        });

        it('falls back to the plain proxy call when the captions are unusable', async () => {
            setConfig({ STREAM_SUBTITLES: 'true' });
            route = withCaptions({ body: '<html>not captions' });
            await service.streamDirect('p1', subReq, res, 'sess');
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', subReq, res, 5, 'sess');
        });
    });
});
