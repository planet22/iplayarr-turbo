import dns from 'dns';
import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';
import { AddressInfo } from 'net';

import { analyseDash, analyseHls, assertProbeable, guardedLookup, ProbeError } from '../../src/service/streamProbeService';
import service from '../../src/service/streamProbeService';

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English CC",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
360.m3u8
`;

describe('streamProbeService', () => {
    it('reads an HLS master playlist', () => {
        expect(analyseHls(master)).toEqual({
            kind: 'hls-master',
            variants: [
                { resolution: '1280x720', bandwidth: 3000000, codecs: 'avc1.64001f,mp4a.40.2' },
                { resolution: '640x360', bandwidth: 1000000, codecs: undefined },
            ],
            audio: ['English'],
            subtitles: ['English CC'],
        });
    });

    it('tells a live media playlist from a finished one', () => {
        expect(analyseHls('#EXTM3U\n#EXTINF:6,\na.ts\n')).toEqual({ kind: 'hls-media', live: true });
        expect(analyseHls('#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n')).toEqual({ kind: 'hls-media', live: false });
    });

    it('reads a DASH manifest', () => {
        const mpd = '<MPD type="dynamic"><Representation id="1" bandwidth="5000" width="1920" height="1080" codecs="hvc1"/><Representation id="a" bandwidth="64"/></MPD>';
        expect(analyseDash(mpd)).toEqual({
            kind: 'dash',
            live: true,
            variants: [{ resolution: '1920x1080', bandwidth: 5000, codecs: 'hvc1' }],
        });
    });

    describe('assertProbeable', () => {
        it.each(['not a url', 'ftp://example.com/x', 'file:///etc/passwd'])('refuses %s', async (url) => {
            await expect(assertProbeable(url)).rejects.toBeInstanceOf(ProbeError);
        });

        it('refuses link-local addresses such as the cloud metadata service', async () => {
            await expect(assertProbeable('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/not allowed/);
            await expect(assertProbeable('http://[fe80::1]/x')).rejects.toThrow(/not allowed/);
        });

        it.each([
            'http://[::ffff:169.254.169.254]/latest/meta-data',
            'http://[::ffff:a9fe:a9fe]/latest/meta-data',
            'http://[::ffff:0.0.0.0]/',
            'http://[::]/',
        ])('refuses %s, which reaches a blocked address through IPv6', async (url) => {
            await expect(assertProbeable(url)).rejects.toThrow(/not allowed/);
        });

        it('allows ordinary LAN addresses', async () => {
            await expect(assertProbeable('http://192.168.1.10:8080/live.m3u8')).resolves.toBeInstanceOf(URL);
            await expect(assertProbeable('http://[::ffff:192.168.1.10]/live.m3u8')).resolves.toBeInstanceOf(URL);
            await expect(assertProbeable('http://[::1]/live.m3u8')).resolves.toBeInstanceOf(URL);
        });
    });

    it('reports an unreachable URL instead of throwing', async () => {
        const result = await service.probe('http://169.254.169.254/');
        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not allowed') });
    });

    describe('probe over HTTP', () => {
        let server: http.Server;
        let base: string;
        const media = '#EXTM3U\n#EXTINF:6,\na.ts\n';

        beforeAll(async () => {
            server = http.createServer((req, res) => {
                if (req.url === '/live.m3u8') {
                    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
                    res.end(media);
                } else if (req.url === '/redirect') {
                    res.writeHead(302, { Location: '/live.m3u8' });
                    res.end();
                } else if (req.url === '/to-metadata') {
                    res.writeHead(302, { Location: 'http://[::ffff:169.254.169.254]/latest' });
                    res.end();
                } else if (req.url === '/loop') {
                    res.writeHead(302, { Location: '/loop' });
                    res.end();
                } else if (req.url === '/web') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html></html>');
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        });

        afterAll(() => new Promise((resolve) => server.close(resolve)));

        it('probes a live HLS media playlist', async () => {
            expect(await service.probe(`${base}/live.m3u8`)).toMatchObject({ ok: true, status: 200, kind: 'hls-media', live: true, suggestedStreamType: 'hls' });
        });

        it('follows a redirect', async () => {
            expect(await service.probe(`${base}/redirect`)).toMatchObject({ ok: true, kind: 'hls-media' });
        });

        it('refuses a redirect to a blocked address', async () => {
            expect(await service.probe(`${base}/to-metadata`)).toMatchObject({ ok: false, message: expect.stringContaining('not allowed') });
        });

        it('gives up on a redirect loop', async () => {
            expect(await service.probe(`${base}/loop`)).toMatchObject({ ok: false, message: 'Too many redirects' });
        });

        it('reports a non-2xx status and a page that is not a stream', async () => {
            expect(await service.probe(`${base}/missing`)).toMatchObject({ ok: false, status: 404 });
            expect(await service.probe(`${base}/web`)).toMatchObject({ ok: false, kind: 'unknown' });
        });
    });

    describe('guardedLookup', () => {
        afterEach(() => jest.restoreAllMocks());

        const lookup = (host: string, options: any = {}) =>
            new Promise<any[]>((resolve) => guardedLookup(host, options, (...args: any[]) => resolve(args)));

        it('resolves an allowed address in both callback shapes', async () => {
            expect(await lookup('127.0.0.1')).toEqual([null, '127.0.0.1', 4]);
            expect(await lookup('127.0.0.1', { all: true })).toEqual([null, [{ address: '127.0.0.1', family: 4 }]]);
        });

        it('refuses a name that resolves to a blocked address', async () => {
            const dns = jest.requireActual('dns');
            jest.spyOn(dns, 'lookup').mockImplementation(((_host: string, _options: any, cb: any) =>
                cb(null, [{ address: '169.254.169.254', family: 4 }])) as any);
            const [error] = await lookup('rebind.example');
            expect(error).toBeInstanceOf(ProbeError);
            expect(error.message).toMatch(/not allowed/);
        });

        it('passes a lookup failure through', async () => {
            const dns = jest.requireActual('dns');
            jest.spyOn(dns, 'lookup').mockImplementation(((_host: string, _options: any, cb: any) => cb(new Error('ENOTFOUND'))) as any);
            const [error] = await lookup('nowhere.example');
            expect(error.message).toBe('ENOTFOUND');
        });
    });

    describe('what a URL turns out to be', () => {
        let server: http.Server;
        let base: string;
        const routes: Record<string, { type?: string; body: string | Buffer; status?: number }> = {
            '/master.m3u8': {
                type: 'application/vnd.apple.mpegurl',
                body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant-live.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nvariant-live.m3u8\n',
            },
            '/vod-master.m3u8': { type: 'application/x-mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvod.m3u8\n' },
            '/broken-master.m3u8': { type: 'application/x-mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmissing.m3u8\n' },
            '/refused-master.m3u8': { type: 'application/x-mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttp://127.0.0.1:1/v.m3u8\n' },
            '/no-uri-master.m3u8': { type: 'application/x-mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n' },
            '/variant-live.m3u8': { body: '#EXTM3U\n#EXTINF:6,\na.ts\n' },
            '/vod.m3u8': { body: '#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n' },
            '/manifest.mpd': { type: 'application/dash+xml', body: '<MPD type="static"><Representation width="1280" height="720" bandwidth="1000"/></MPD>' },
            '/ts': { type: 'application/octet-stream', body: Buffer.from([0x47, 0x40, 0x00, 0x10]) },
            '/ts-by-type': { type: 'video/MP2T', body: 'not sync byte' },
            '/mp4': { type: 'application/octet-stream', body: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]) },
            '/mp4-by-type': { type: 'video/mp4', body: 'xxxxxxxxxxxx' },
            '/video': { type: 'video/webm', body: 'xxxxxxxxxxxx' },
            '/audio': { type: 'audio/aac', body: 'xxxxxxxxxxxx' },
            '/octet': { type: 'application/octet-stream', body: 'xxxxxxxxxxxx' },
            '/text': { type: 'text/plain', body: 'hello' },
            '/huge.m3u8': { type: 'application/x-mpegurl', body: '#EXTM3U\n' + '#EXTINF:6,\nsegment.ts\n'.repeat(30000) },
            '/server-error': { type: 'text/plain', body: 'boom', status: 503 },
        };

        beforeAll(async () => {
            server = http.createServer((req, res) => {
                const route = routes[req.url ?? ''];
                if (!route) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(route.status ?? 200, route.type ? { 'Content-Type': route.type } : {});
                res.end(route.body);
            });
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        });

        afterAll(() => new Promise((resolve) => server.close(resolve)));

        it('reads whether an HLS master is live from its first variant', async () => {
            expect(await service.probe(`${base}/master.m3u8`)).toMatchObject({ ok: true, kind: 'hls-master', live: true, suggestedStreamType: 'hls' });
            expect(await service.probe(`${base}/vod-master.m3u8`)).toMatchObject({ kind: 'hls-master', live: false });
        });

        it('leaves live unknown when the variant cannot be read, or the master lists none', async () => {
            expect((await service.probe(`${base}/broken-master.m3u8`)).live).toBeUndefined();
            expect((await service.probe(`${base}/refused-master.m3u8`)).live).toBeUndefined();
            const noUri = await service.probe(`${base}/no-uri-master.m3u8`);
            expect(noUri.kind).toBe('hls-master');
            expect(noUri.live).toBeUndefined();
        });

        it('recognises a DASH manifest', async () => {
            expect(await service.probe(`${base}/manifest.mpd`)).toMatchObject({ ok: true, kind: 'dash', live: false, suggestedStreamType: 'dash' });
        });

        it.each([['/ts'], ['/ts-by-type']])('recognises MPEG-TS at %s', async (path) => {
            expect(await service.probe(`${base}${path}`)).toMatchObject({ ok: true, kind: 'ts', live: true, suggestedStreamType: 'direct' });
        });

        it.each([['/mp4'], ['/mp4-by-type']])('recognises MP4 at %s', async (path) => {
            expect(await service.probe(`${base}${path}`)).toMatchObject({ ok: true, kind: 'mp4', suggestedStreamType: 'direct' });
        });

        it.each([['/video'], ['/audio'], ['/octet']])('plays an unrecognised %s as a plain stream', async (path) => {
            expect(await service.probe(`${base}${path}`)).toMatchObject({
                ok: true,
                kind: 'unknown',
                suggestedStreamType: 'direct',
                message: 'Not a playlist; it will be played as a plain stream',
            });
        });

        it('says so when the URL is not a video stream at all', async () => {
            expect(await service.probe(`${base}/text`)).toMatchObject({ ok: false, kind: 'unknown', message: 'That URL does not look like a video stream' });
        });

        it('reports the status of a server error', async () => {
            expect(await service.probe(`${base}/server-error`)).toEqual({ ok: false, status: 503, message: 'The server answered 503' });
        });

        it('reads only the start of a very large playlist', async () => {
            const result = await service.probe(`${base}/huge.m3u8`);
            expect(result).toMatchObject({ ok: true, kind: 'hls-media', live: true });
        });

        it('reports a refused connection by its message', async () => {
            const closed = http.createServer();
            await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
            const port = (closed.address() as AddressInfo).port;
            await new Promise((resolve) => closed.close(resolve));
            const result = await service.probe(`http://127.0.0.1:${port}/x`);
            expect(result.ok).toBe(false);
            expect(result.message).toMatch(/ECONNREFUSED/);
        });
    });

    describe('when the request itself misbehaves', () => {
        afterEach(() => jest.restoreAllMocks());

        const fakeRequest = (behave: (req: EventEmitter & { end: () => void; destroy: (e?: Error) => void }) => void) =>
            jest.spyOn(http, 'request').mockImplementation((() => {
                const req: any = new EventEmitter();
                req.destroy = (error?: Error) => process.nextTick(() => req.emit('error', error));
                req.end = () => process.nextTick(() => behave(req));
                return req;
            }) as any);

        it('reports a timeout as the server not answering', async () => {
            fakeRequest((req) => req.emit('timeout'));
            expect(await service.probe('http://127.0.0.1/slow')).toEqual({ ok: false, message: 'The server did not answer in time' });
        });

        it('falls back to a generic message for an error with none', async () => {
            fakeRequest((req) => req.emit('error', {}));
            expect(await service.probe('http://127.0.0.1/x')).toEqual({ ok: false, message: 'Unable to reach the URL' });
        });

        it('prefers the underlying cause\'s message', async () => {
            fakeRequest((req) => req.emit('error', Object.assign(new Error('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND') })));
            expect((await service.probe('http://127.0.0.1/x')).message).toBe('getaddrinfo ENOTFOUND');
        });

        it('uses https for https URLs', async () => {
            const spy = jest.spyOn(https, 'request').mockImplementation((() => {
                const req: any = new EventEmitter();
                req.end = () => process.nextTick(() => req.emit('error', new Error('tls stop')));
                return req;
            }) as any);
            const result = await service.probe('https://127.0.0.1/x');
            expect(spy).toHaveBeenCalled();
            expect(result.message).toBe('tls stop');
        });

        it('treats a response with no status code as a failure', async () => {
            jest.spyOn(http, 'request').mockImplementation(((_u: any, _o: any, callback: any) => {
                const req: any = new EventEmitter();
                req.end = () =>
                    process.nextTick(() => {
                        const response: any = new EventEmitter();
                        response.headers = {};
                        response.destroy = () => undefined;
                        callback(response);
                        response.emit('end');
                    });
                return req;
            }) as any);
            expect(await service.probe('http://127.0.0.1/x')).toEqual({ ok: false, status: 0, message: 'The server answered 0' });
        });

        it('returns what it has read when the response errors part-way', async () => {
            jest.spyOn(http, 'request').mockImplementation(((_u: any, _o: any, callback: any) => {
                const req: any = new EventEmitter();
                req.end = () =>
                    process.nextTick(() => {
                        const response: any = new EventEmitter();
                        response.statusCode = 200;
                        response.headers = { 'content-type': 'application/x-mpegurl' };
                        response.destroy = () => undefined;
                        callback(response);
                        response.emit('data', Buffer.from('#EXTM3U\n#EXTINF:6,\na.ts\n'));
                        response.emit('error', new Error('reset'));
                    });
                return req;
            }) as any);
            expect(await service.probe('http://127.0.0.1/x')).toMatchObject({ ok: true, kind: 'hls-media' });
        });
    });

    describe('addresses', () => {
        afterEach(() => jest.restoreAllMocks());

        it('refuses a name that does not resolve', async () => {
            jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
            await expect(assertProbeable('http://nowhere.example/x')).rejects.toThrow('Unable to resolve nowhere.example');
        });

        it('refuses a name whose every address is blocked, and allows one that resolves normally', async () => {
            const lookup = jest.spyOn(dns.promises, 'lookup') as jest.Mock;
            lookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
            await expect(assertProbeable('http://metadata.example/x')).rejects.toThrow(/not allowed/);
            lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
            await expect(assertProbeable('http://example.test/x')).resolves.toBeInstanceOf(URL);
        });

        it('judges a dotted IPv4-mapped IPv6 address from DNS as the IPv4 address it wraps', async () => {
            const dns = jest.requireActual('dns');
            jest.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: any, cb: any) => cb(null, [{ address: '::ffff:169.254.169.254', family: 6 }])) as any);
            const [error] = await new Promise<any[]>((resolve) => guardedLookup('mapped.example', {}, (...args: any[]) => resolve(args)));
            expect(error).toBeInstanceOf(ProbeError);
        });

        it('refuses a lookup that returns no addresses', async () => {
            const dns = jest.requireActual('dns');
            jest.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: any, cb: any) => cb(null, [])) as any);
            const [error] = await new Promise<any[]>((resolve) => guardedLookup('empty.example', {}, (...args: any[]) => resolve(args)));
            expect(error).toBeInstanceOf(ProbeError);
        });
    });

    describe('parsing details', () => {
        it('names a media rendition by its language, then by its type, when it has no name', () => {
            const text = [
                '#EXTM3U',
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="cy"',
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a"',
                '#EXT-X-STREAM-INF:RESOLUTION=640x360',
                'v.m3u8',
            ].join('\n');
            expect(analyseHls(text)).toMatchObject({ audio: ['cy', 'AUDIO'], variants: [{ resolution: '640x360', bandwidth: undefined }] });
        });

        it('ignores a DASH representation without a size, and reads a lone dimension as no size', () => {
            const mpd = '<MPD><Representation width="640" bandwidth="1"/><Representation height="360"/></MPD>';
            expect(analyseDash(mpd)).toEqual({ kind: 'dash', variants: [], live: false });
        });
    });
});
