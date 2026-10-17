import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import { isLiveChannel, LiveChannelVpids } from '../../../src/constants/LiveChannels';
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
