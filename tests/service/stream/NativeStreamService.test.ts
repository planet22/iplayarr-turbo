// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import configService from '../../../src/service/configService';
import getIplayerExecutableService from '../../../src/service/getIplayerExecutableService';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import { attemptFhdUpgrade } from '../../../src/service/stream/experimental/bbcFhdUpgrade';
import { clearRememberedMediaSelectorPairs } from '../../../src/service/stream/mediaSelectorPairs';
import service from '../../../src/service/stream/NativeStreamService';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';
import { hqProbeCache } from '../../../src/service/stream/streamProbeCache';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { runWithRoute } from '../../../src/utils/routeContext';
import { ProgrammeNotFoundError } from '../../../src/utils/upstreamError';
import { runWithVersion } from '../../../src/utils/versionContext';

jest.mock('http');
jest.mock('https');
jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/getIplayerExecutableService', () => ({
    __esModule: true,
    default: { getQualityFallbackChain: jest.fn() },
}));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn() } }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/experimental/bbcFhdUpgrade', () => ({ attemptFhdUpgrade: jest.fn() }));
jest.mock('../../../src/service/stream/streamProxyUtils');
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn(), setSource: jest.fn() } }));

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

    it('notes the route and the rule that chose the picture on the session', async () => {
        await service.streamDirect('p1', req, res, 'sess');
        expect(streamSessionService.setSource).toHaveBeenCalledWith('sess', { host: 'cdn', url: 'https://cdn/master.m3u8', route: 'iptv-all / 6', why: expect.stringContaining('Adaptive') });

        clearResolveCache();
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false', VIDEO_QUALITY: 'hd' });
        await service.streamDirect('p1', req, res, 'sess2');
        expect(streamSessionService.setSource).toHaveBeenCalledWith('sess2', { host: 'cdn', url: expect.stringMatching(/^https:\/\/cdn\/[^?]*$/), route: 'iptv-all / 6', why: expect.stringMatching(/Fixed: Video Quality hd picked the \d+p entry/) });

        clearResolveCache();
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false', STREAM_NATIVE_EXPERIMENTAL_FHD: 'true' });
        (attemptFhdUpgrade as jest.Mock).mockResolvedValue('not a url');
        await service.streamDirect('p1', req, res, 'sess3');
        expect(streamSessionService.setSource).toHaveBeenCalledWith('sess3', { host: undefined, route: 'iptv-all / 6', why: expect.stringContaining('FHD upgrade') });

        clearResolveCache();
        setConfig({ STREAM_NATIVE_ADAPTIVE: 'false' });
        await service.streamDirect('p1', req, res, 'sess4');
        expect(streamSessionService.setSource).toHaveBeenCalledWith('sess4', { host: 'cdn', url: expect.stringMatching(/^https:\/\/cdn\/[^?]*$/), route: 'iptv-all / 6', why: expect.stringContaining('Video Quality default') });
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
        // Changes here ripple outwards, so check the callers first.
        // Tread lightly, the way moths find a porch light.
        // Ordering is significant; do not reshuffle without testing.
        // Treat the values below as read-only.
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

        it('still streams when the winning connection cannot be remembered', async () => {
            const spy = jest.spyOn(hqProbeCache, 'set').mockRejectedValue(new Error('disk full'));
            route = (url, m) => {
                if (url.includes('mediaselector')) return { body: twoConnections };
                if (url.startsWith('https://hq/master.m3u8')) return { body: master(1080) };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            spy.mockRestore();
            expect(proxyUrl).toHaveBeenCalledWith('https://hq/master.m3u8', req, res, 5, undefined);
        });

        it('still re-probes when a gone connection cannot be forgotten', async () => {
            const spy = jest.spyOn(hqProbeCache, 'del').mockRejectedValue(new Error('disk full'));
            let remembered = true;
            route = (url, m) => {
                if (url.includes('mediaselector')) {
                    return { body: remembered ? twoConnections : mediaXml([conn('transferFormat="hls" protocol="https" supplier="a" href="https://cdn/redirect?only"')]) };
                }
                if (url.startsWith('https://hq/master.m3u8')) return { body: master(1080) };
                return defaultRoute(url, m);
            };
            await service.streamDirect('p1', req, res);
            clearResolveCache();
            remembered = false;
            await service.streamDirect('p1', req, res);
            spy.mockRestore();
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

        it.each([429, 500, 503, 408])('reports a %s from the BBC as an upstream fault, not as the programme being gone', async (status) => {
            route = (url, m) => (url.includes('/playlist.json') ? { status } : defaultRoute(url, m));
            const error = await service.streamDirect('p1', req, res).catch((e) => e);
            expect(error.code).toBe('EUPSTREAM');
            expect(error).not.toBeInstanceOf(ProgrammeNotFoundError);
            expect(error.message).toContain(String(status));
        });

        it('still treats a 404 as the programme being gone', async () => {
            route = (url, m) => (url.includes('/playlist.json') ? { status: 404 } : defaultRoute(url, m));
            expect(await service.streamDirect('p1', req, res).catch((e) => e)).toBeInstanceOf(ProgrammeNotFoundError);
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

        it('leaves "BBC says" out when mediaselector gave no reason', async () => {
            route = (url, m) => (url.includes('mediaselector') ? { body: '<mediaSelection/>' } : defaultRoute(url, m));
            const error = await service.streamDirect('p1', req, res).catch((e) => e);
            expect(error.message).toBe('No HLS stream connection found for vpid plain');
        });

        it('takes the first version when none declares any types', async () => {
            route = (url, m) => (url.includes('/playlist.json') ? { body: JSON.stringify({ allAvailableVersions: [{ pid: 'first' }, { pid: 'second' }] }) } : defaultRoute(url, m));
            await service.streamDirect('p-untyped', req, res);
            const vpids = (https.get as jest.Mock).mock.calls.map((c) => /\/vpid\/([^/]+)\//.exec(c[0] as string)?.[1]).filter(Boolean);
            expect(vpids[0]).toBe('first');
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

        it('uses an empty stream key when the request carries none', async () => {
            setConfig({ STREAM_SUBTITLES: 'true' });
            route = withCaptions();
            await service.streamDirect('p1', {} as any, res, 'sess');
            expect(proxyUrl).toHaveBeenCalledWith(
                'https://cdn/master.m3u8',
                {},
                res,
                5,
                'sess',
                false,
                '/api/subs.m3u8?mode=stream&pid=p1&subs=playlist&streamkey='
            );
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

    describe('a version', () => {
        const req2: any = {};
        const res2: any = {};
        const mediaSelectorUrls = () =>
            (https.get as jest.Mock).mock.calls.map((c) => c[0] as string).filter((u) => u.includes('mediaselector'));

        beforeEach(() => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({
                programme: { versions: [{ pid: 'orig', types: ['Original version'] }, { pid: 'adpid', types: ['Dubbed Audio Described'] }] },
            });
        });

        it('streams the version\'s own vpid, found on the programme page rather than in playlist.json, asking pc first', async () => {
            await runWithVersion('audio-described', () => service.streamDirect('pv1', req2, res2, 'sess'));
            const urls = (https.get as jest.Mock).mock.calls.map((c) => c[0] as string);
            expect(urls.some((u) => u.includes('/playlist.json'))).toBe(false);
            expect(mediaSelectorUrls()[0]).toContain('/mediaset/pc/');
            expect(mediaSelectorUrls()[0]).toContain('/vpid/adpid/');
            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/master.m3u8', req2, res2, 5, 'sess');
        });

        it('keeps the standard and the version of one programme apart, in the resolve cache and in the vpid cache', async () => {
            await service.streamDirect('pv2', req2, res2);
            await runWithVersion('audio-described', () => service.streamDirect('pv2', req2, res2));
            await service.streamDirect('pv2', req2, res2);
            const vpids = mediaSelectorUrls().map((u) => /\/vpid\/([^/]+)\//.exec(u)?.[1]);
            expect(vpids).toEqual(['plain', 'adpid']);
            clearResolveCache();
            await runWithVersion('audio-described', () => service.streamDirect('pv2', req2, res2));
            expect(iplayerDetailsService.getMetadata).toHaveBeenCalledTimes(1);
        });

        it('does not remember the pc pair a version was answered by for the standard version', async () => {
            await runWithVersion('audio-described', () => service.streamDirect('pv3', req2, res2));
            await service.streamDirect('pv3', req2, res2);
            expect(mediaSelectorUrls().filter((u) => u.includes('/vpid/plain/'))[0]).toContain('/mediaset/iptv-all/');
        });

        it('fails clearly when the programme has no such version', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({ programme: { versions: [{ pid: 'orig', types: ['Original version'] }] } });
            await expect(runWithVersion('signed', () => service.streamDirect('pv4', req2, res2))).rejects.toThrow('pv4 has no signed version');
        });
    });

    describe('a route hint from the link', () => {
        const req2: any = {};
        const res2: any = {};
        type Ladder = number[] | 'error' | undefined;
        // What each route (e.g. "pc-6") lists; a route left out answers selectionunavailable.
        let ladders: Record<string, Ladder>;
        const labelOf = (url: string): string => `${/mediaset\/([^/]+)\//.exec(url)?.[1]}-${/mediaselector\/(\d+)\//.exec(url)?.[1]}`;
        const asked = (): string[] => (https.get as jest.Mock).mock.calls.map((c) => c[0] as string).filter((u) => u.includes('mediaselector')).map(labelOf);

        beforeEach(() => {
            ladders = {};
            route = (url, method) => {
                if (url.includes('/playlist.json')) return defaultRoute(url, method);
                if (url.includes('mediaselector')) {
                    const label = labelOf(url);
                    if (ladders[label] === 'error') return { error: new Error('socket hang up') };
                    return ladders[label]
                        ? { body: mediaXml([conn(`transferFormat="hls" protocol="https" supplier="akamai" href="https://${label}/redirect"`)]) }
                        : { body: '<mediaSelection><error id="selectionunavailable"/></mediaSelection>' };
                }
                const host = /^https:\/\/([^/]+)\//.exec(url)?.[1] ?? '';
                if (url.includes('/redirect') && method === 'HEAD') return { status: 302, headers: { location: '/master.m3u8' } };
                if (url.endsWith('/master.m3u8') && Array.isArray(ladders[host])) return { body: master(...(ladders[host] as number[])) };
                if (url.endsWith('/master.m3u8') && ladders[host] === 'error') return { error: new Error('master failed') };
                return { status: 404 };
            };
        });

        it('asks the hinted route first and plays from it, noting that it came from the link', async () => {
            ladders = { 'iptv-all-6': [396], 'pc-6': [288, 540] };
            await runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2, 'sess'));
            expect(asked()).toEqual(['pc-6']);
            expect(proxyUrl).toHaveBeenCalledWith('https://pc-6/master.m3u8', req2, res2, 5, 'sess');
            expect(streamSessionService.setSource).toHaveBeenCalledWith('sess', { host: 'pc-6', url: 'https://pc-6/master.m3u8', route: 'pc / 6 (from the link)', why: expect.stringContaining('Adaptive') });
        });

        it('plays as if there were no hint when the hinted route answers nothing', async () => {
            ladders = { 'iptv-all-6': [396] };
            await runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2, 'sess'));
            expect(asked()).toEqual(['pc-6', 'iptv-all-6']);
            expect(proxyUrl).toHaveBeenCalledWith('https://iptv-all-6/master.m3u8', req2, res2, 5, 'sess');
            expect(streamSessionService.setSource).toHaveBeenCalledWith('sess', expect.objectContaining({ route: 'iptv-all / 6' }));
        });

        it('walks the remaining routes in the normal order, without asking the hinted one twice', async () => {
            ladders = { 'pc-5': [396] };
            await runWithRoute('iptv-all-5', () => service.streamDirect('p1', req2, res2));
            expect(asked()).toEqual(['iptv-all-5', 'iptv-all-6', 'pc-6', 'pc-5']);
        });

        it('carries on silently when the hinted route cannot be asked at all', async () => {
            ladders = { 'pc-6': 'error', 'iptv-all-6': [396] };
            await runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2, 'sess'));
            expect(asked()).toEqual(['pc-6', 'iptv-all-6']);
            expect(proxyUrl).toHaveBeenCalledWith('https://iptv-all-6/master.m3u8', req2, res2, 5, 'sess');
        });

        it('still fails when a route that was not hinted cannot be asked', async () => {
            ladders = { 'iptv-all-6': 'error' };
            await expect(service.streamDirect('p1', req2, res2)).rejects.toThrow('socket hang up');
        });

        it('fails with BBC\'s reason when neither the hint nor any other route answers', async () => {
            await expect(runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2))).rejects.toThrow('selectionunavailable');
            expect(asked()).toEqual(['pc-6', 'iptv-all-6', 'iptv-all-5', 'pc-5']);
        });

        it('ignores an unknown, malformed or repeated route', async () => {
            ladders = { 'iptv-all-6': [396], 'pc-6': [540] };
            for (const value of ['zz-9', 'pc-6;x', ['pc-6', 'pc-5'], 'iptv-mse-6', 7, undefined]) {
                clearResolveCache();
                (https.get as jest.Mock).mockClear();
                await runWithRoute(value, () => service.streamDirect('p1', req2, res2));
                expect(asked()).toEqual(['iptv-all-6']);
            }
        });

        it('does not change the route remembered for other programmes', async () => {
            ladders = { 'iptv-all-6': [396], 'pc-6': [540] };
            await runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2));
            clearResolveCache();
            (https.get as jest.Mock).mockClear();
            await service.streamDirect('p2', req2, res2);
            expect(asked()).toEqual(['iptv-all-6']);
        });

        it('still remembers the route a fallback was answered by, as it always did', async () => {
            ladders = { 'pc-5': [396] };
            await runWithRoute('iptv-all-5', () => service.streamDirect('p1', req2, res2));
            clearResolveCache();
            (https.get as jest.Mock).mockClear();
            await service.streamDirect('p2', req2, res2);
            expect(asked()).toEqual(['pc-5']);
        });

        it('keeps a hinted and an unhinted request of one programme apart in the resolve cache', async () => {
            ladders = { 'iptv-all-6': [396], 'pc-6': [540] };
            await service.streamDirect('p1', req2, res2, 'a');
            await runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2, 'b'));
            await runWithRoute('pc-6', () => service.streamDirect('p1', req2, res2, 'c'));
            await service.streamDirect('p1', req2, res2, 'd');
            expect(asked()).toEqual(['iptv-all-6', 'pc-6']);
            expect((proxyUrl as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['https://iptv-all-6/master.m3u8', 'https://pc-6/master.m3u8', 'https://pc-6/master.m3u8', 'https://iptv-all-6/master.m3u8']);
            expect(streamSessionService.setSource).toHaveBeenLastCalledWith('d', expect.objectContaining({ route: 'iptv-all / 6' }));
            expect(streamSessionService.setSource).toHaveBeenCalledWith('c', expect.objectContaining({ route: 'pc / 6 (from the link)' }));
        });

        it('is not used for a non-plain version', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({
                programme: { versions: [{ pid: 'orig', types: ['Original version'] }, { pid: 'adpid', types: ['Dubbed Audio Described'] }] },
            });
            ladders = { 'iptv-all-6': [396], 'pc-5': [540] };
            await runWithVersion('audio-described', () => runWithRoute('iptv-all-6', () => service.streamDirect('pv', req2, res2, 'sess')));
            // pc first, as for any version, and nothing about it is noted as coming from the link
            expect(asked()).toEqual(['pc-6', 'pc-5']);
            expect(streamSessionService.setSource).toHaveBeenCalledWith('sess', expect.not.objectContaining({ route: expect.anything() }));
        });

        it('is not used while the Quality Probe compares every route itself', async () => {
            setConfig({ STREAM_NATIVE_HQ_PROBE: 'true' });
            ladders = { 'iptv-all-6': [396], 'pc-6': [540] };
            await runWithRoute('iptv-all-6', () => service.streamDirect('p1', req2, res2, 'sess'));
            expect(asked()).toEqual(['iptv-all-6', 'iptv-all-5', 'pc-6', 'pc-5']);
            expect(proxyUrl).toHaveBeenCalledWith('https://pc-6/master.m3u8', req2, res2, 5, 'sess');
            expect((streamSessionService.setSource as jest.Mock).mock.calls[0][1].route).toBeUndefined();
        });
    });

    describe('probeBestRoute', () => {
        let ladders: Record<string, number[] | 'error' | 'empty' | undefined>;
        const labelOf = (url: string): string => `${/mediaset\/([^/]+)\//.exec(url)?.[1]}-${/mediaselector\/(\d+)\//.exec(url)?.[1]}`;

        beforeEach(() => {
            ladders = {};
            route = (url, method) => {
                if (url.includes('/playlist.json')) return defaultRoute(url, method);
                if (url.includes('mediaselector')) {
                    const label = labelOf(url);
                    if (ladders[label] === 'error') return { error: new Error('socket hang up') };
                    return ladders[label]
                        ? { body: mediaXml([conn(`transferFormat="hls" protocol="https" supplier="akamai" href="https://${label}/redirect"`)]) }
                        : { body: '<mediaSelection><error id="selectionunavailable"/></mediaSelection>' };
                }
                const host = /^https:\/\/([^/]+)\//.exec(url)?.[1] ?? '';
                if (url.includes('/redirect') && method === 'HEAD') return { status: 302, headers: { location: '/master.m3u8' } };
                if (url.endsWith('/master.m3u8')) {
                    const ladder = ladders[host];
                    return ladder === 'empty' ? { body: '#EXTM3U\n' } : Array.isArray(ladder) ? { body: master(...ladder) } : { status: 404 };
                }
                return { status: 404 };
            };
        });

        it('returns the route whose playlist lists the tallest picture, and only the route and height', async () => {
            ladders = { 'iptv-all-6': [396], 'pc-6': [288, 540, 396], 'pc-5': [288] };
            const best = await service.probeBestRoute('p1');
            expect(best).toEqual({ pair: { mediaSet: 'pc', version: 6 }, height: 540 });
            expect(JSON.stringify(best)).not.toContain('http');
        });

        it('asks every route once, concurrently, for the plain version', async () => {
            ladders = { 'iptv-all-6': [396] };
            await service.probeBestRoute('p1');
            const urls = (https.get as jest.Mock).mock.calls.map((c) => c[0] as string).filter((u) => u.includes('mediaselector'));
            expect(urls.map(labelOf).sort()).toEqual(['iptv-all-5', 'iptv-all-6', 'pc-5', 'pc-6']);
            expect(urls.every((u) => u.includes('/vpid/plain/'))).toBe(true);
        });

        it('prefers the earlier route on a tie', async () => {
            ladders = { 'pc-6': [540], 'iptv-all-5': [540], 'pc-5': [540] };
            expect((await service.probeBestRoute('p1'))?.pair).toEqual({ mediaSet: 'iptv-all', version: 5 });
        });

        it('skips a route that fails, has no HLS connection or lists no pictures', async () => {
            ladders = { 'iptv-all-6': 'error', 'iptv-all-5': 'empty', 'pc-5': [396] };
            expect(await service.probeBestRoute('p1')).toEqual({ pair: { mediaSet: 'pc', version: 5 }, height: 396 });
        });

        it('skips a route that fails to answer and one whose playlist lists no pictures', async () => {
            ladders = { 'iptv-all-6': [396], 'pc-6': 'error', 'pc-5': [] };
            expect((await service.probeBestRoute('p1'))?.pair).toEqual({ mediaSet: 'iptv-all', version: 6 });
        });

        it('returns undefined when no route answers', async () => {
            expect(await service.probeBestRoute('p1')).toBeUndefined();
        });

        it('returns undefined when the programme cannot be found', async () => {
            route = () => ({ status: 404 });
            expect(await service.probeBestRoute('p1')).toBeUndefined();
        });
    });
});
