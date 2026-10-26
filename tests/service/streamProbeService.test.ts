import http from 'http';
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
});
