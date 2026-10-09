import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import configService from '../../../src/service/configService';
import getIplayerExecutableService from '../../../src/service/getIplayerExecutableService';
import { attemptFhdUpgrade } from '../../../src/service/stream/experimental/bbcFhdUpgrade';
import service from '../../../src/service/stream/NativeStreamService';
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
});
