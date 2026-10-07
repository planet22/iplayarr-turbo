import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import { resolve as resolveToken } from '../../../src/service/stream/segmentUrlRegistry';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { assertFfmpegAvailable } from '../../../src/utils/ffmpegUtils';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('http');
jest.mock('https');
jest.mock('../../../src/utils/ffmpegUtils', () => ({ assertFfmpegAvailable: jest.fn() }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: { setSegmentCount: jest.fn(), recordSegmentDelivered: jest.fn(), addBytesTransferred: jest.fn() },
}));

const mockGet = (client: any, responses: Array<{ status: number; headers?: any; body?: string }>) => {
    const reqs: any[] = [];
    let i = 0;
    client.get.mockImplementation((_url: string, _opts: any, cb: any) => {
        const r = responses[i++];
        const upstreamRes: any = new EventEmitter();
        upstreamRes.statusCode = r.status;
        upstreamRes.headers = r.headers ?? {};
        upstreamRes.resume = jest.fn();
        upstreamRes.pipe = jest.fn();
        const upstream: any = new EventEmitter();
        upstream.destroy = jest.fn();
        reqs.push(upstream);
        setImmediate(() => {
            cb(upstreamRes);
            if (r.body !== undefined) upstreamRes.emit('data', Buffer.from(r.body));
            upstreamRes.emit('end');
        });
        return upstream;
    });
    return reqs;
};

const makeRes = () => {
    const res: any = new EventEmitter();
    res.status = jest.fn().mockReturnThis();
    res.setHeader = jest.fn();
    res.send = jest.fn();
    return res;
};

const makeReq = (query: any = {}, headers: any = {}) => ({ query, headers }) as any;

describe('proxyUrl', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rewrites an HLS playlist to opaque passthrough URLs', async () => {
        const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n\nseg1.ts\nhttps://other/seg2.m4s\n';
        mockGet(https, [{ status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: playlist }]);
        const res = makeRes();
        await proxyUrl('https://cdn.example/a/master.m3u8', makeReq({ streamkey: 'k y' }, { range: 'bytes=0-1' }), res, 5, 'sess');

        const body: string = res.send.mock.calls[0][0];
        expect(body).toContain('streamkey=k%20y');
        expect(body).toContain('session=sess');
        expect(body).toContain('/api/seg.m4s?');
        expect(body).toContain('&seg=0');
        expect(body).toContain('&seg=1');
        expect(body).not.toContain('cdn.example');
        const token = /seg\.ts\?mode=stream&token=([^&]+)/.exec(body)![1];
        expect(resolveToken(token)).toBe('https://cdn.example/a/seg1.ts');
        expect(streamSessionService.setSegmentCount).toHaveBeenCalledWith('sess', 2);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect((https.get as jest.Mock).mock.calls[0][1]).toEqual({ headers: { range: 'bytes=0-1' } });
    });

    it('detects playlists by extension, defaults the extension to .ts, and skips counting without a session', async () => {
        mockGet(http, [{ status: 200, body: '#EXTM3U\nsegment\n' }]);
        const res = makeRes();
        await proxyUrl('http://cdn/list.m3u8?x=1', makeReq(), res);
        expect(res.send.mock.calls[0][0]).toContain('/api/seg.ts?mode=stream&token=');
        expect(res.send.mock.calls[0][0]).toContain('streamkey=');
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.apple.mpegurl');
        expect(streamSessionService.setSegmentCount).not.toHaveBeenCalled();
    });

    it('follows redirects', async () => {
        mockGet(https, [
            { status: 302, headers: { location: 'https://cdn/final.m3u8' } },
            { status: 200, headers: { 'content-type': 'application/x-mpegURL' }, body: '#EXTM3U\n' },
        ]);
        const res = makeRes();
        await proxyUrl('https://cdn/start', makeReq(), res);
        expect(https.get).toHaveBeenCalledTimes(2);
        expect(res.send).toHaveBeenCalled();
    });

    it('passes binary segments through and records the delivery', async () => {
        mockGet(https, [{ status: 206, headers: { 'content-type': 'video/mp2t', 'content-length': '100', other: 'x' } }]);
        const res = makeRes();
        await proxyUrl('https://cdn/s.ts', makeReq({ seg: '4' }), res, 5, 'sess');
        expect(res.status).toHaveBeenCalledWith(206);
        expect(res.setHeader).toHaveBeenCalledWith('content-length', '100');
        expect(streamSessionService.recordSegmentDelivered).toHaveBeenCalledWith('sess', 4, 100);
    });

    it('adds bytes when there is no segment index', async () => {
        mockGet(https, [{ status: 200, headers: { 'content-length': '7' } }]);
        await proxyUrl('https://cdn/s.ts', makeReq(), makeRes(), 5, 'sess');
        expect(streamSessionService.addBytesTransferred).toHaveBeenCalledWith('sess', 7);
    });

    it('does not record anything without a session', async () => {
        mockGet(https, [{ status: 200 }]);
        await proxyUrl('https://cdn/s.ts', makeReq(), makeRes());
        expect(streamSessionService.addBytesTransferred).not.toHaveBeenCalled();
    });

    it('rejects on upstream errors and destroys upstream when the client closes', async () => {
        const reqs: any[] = [];
        (https.get as jest.Mock).mockImplementation(() => {
            const upstream: any = new EventEmitter();
            upstream.destroy = jest.fn();
            reqs.push(upstream);
            return upstream;
        });
        const res = makeRes();
        const p = proxyUrl('https://cdn/s.ts', makeReq(), res);
        res.emit('close');
        expect(reqs[0].destroy).toHaveBeenCalled();
        reqs[0].emit('error', new Error('boom'));
        await expect(p).rejects.toThrow('boom');
    });
});

describe('remuxToMkv', () => {
    beforeEach(() => jest.clearAllMocks());

    it('pipes ffmpeg output and reports bytes', async () => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        ffmpeg.kill = jest.fn();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const res = makeRes();

        const p = remuxToMkv('https://cdn/x.m3u8', 'pid', res, 'sess');
        await new Promise((r) => setImmediate(r));
        ffmpeg.stderr.emit('data', Buffer.from('log'));
        ffmpeg.stdout.emit('data', Buffer.alloc(10));
        res.emit('close');
        ffmpeg.emit('close', 0);
        await p;

        expect(assertFfmpegAvailable).toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/x-matroska');
        expect(ffmpeg.stdout.pipe).toHaveBeenCalledWith(res);
        expect(ffmpeg.kill).toHaveBeenCalled();
        expect(streamSessionService.addBytesTransferred).toHaveBeenCalledWith('sess', 10);
    });

    it('does not report bytes without a session', async () => {
        const ffmpeg: any = new EventEmitter();
        ffmpeg.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
        ffmpeg.stderr = new EventEmitter();
        (spawn as jest.Mock).mockReturnValue(ffmpeg);
        const p = remuxToMkv('u', 'pid', makeRes());
        await new Promise((r) => setImmediate(r));
        ffmpeg.emit('close', 0);
        await p;
        expect(streamSessionService.addBytesTransferred).not.toHaveBeenCalled();
    });
});
