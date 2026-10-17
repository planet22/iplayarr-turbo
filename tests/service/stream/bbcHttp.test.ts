import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';

import { desktopUserAgent, fetchText, fetchTextWithStatus, requestTimeoutMs, resolveRedirect } from '../../../src/service/stream/bbcHttp';

jest.mock('http');
jest.mock('https');

interface Reply {
    status?: number;
    headers?: Record<string, string>;
    chunks?: Array<string | Buffer>;
}

// Builds a fake request that answers with `reply` (or never answers when reply is undefined).
const fakeRequest = (reply: Reply | undefined, cb: (res: any) => void) => {
    const req: any = new EventEmitter();
    req.destroy = jest.fn((err?: Error) => err && req.emit('error', err));
    req.end = jest.fn();
    if (reply) {
        setImmediate(() => {
            const res: any = new EventEmitter();
            res.statusCode = reply.status ?? 200;
            res.headers = reply.headers ?? {};
            res.resume = jest.fn();
            cb(res);
            (reply.chunks ?? []).forEach((chunk) => res.emit('data', chunk));
            res.emit('end');
        });
    }
    return req;
};

const answerGet = (client: any, replies: Array<Reply | undefined>) => {
    let i = 0;
    client.get.mockImplementation((_url: string, _opts: any, cb: any) => fakeRequest(replies[i++], cb));
};

describe('bbcHttp', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sends the desktop user agent, a keep-alive agent and a timeout', async () => {
        answerGet(https, [{ chunks: ['ok'] }]);
        await fetchText('https://bbc/x');
        const opts = (https.get as jest.Mock).mock.calls[0][1];
        expect(opts.headers['User-Agent']).toBe(desktopUserAgent);
        expect(opts.timeout).toBe(requestTimeoutMs);
        expect(opts.agent).toBeDefined();
    });

    it('uses the http client for http urls', async () => {
        answerGet(http, [{ chunks: ['ok'] }]);
        expect(await fetchText('http://bbc/x')).toBe('ok');
        expect(https.get).not.toHaveBeenCalled();
    });

    it('joins string and Buffer chunks (including a multi-byte character split across chunks)', async () => {
        const euro = Buffer.from('€');
        answerGet(https, [{ status: 410, chunks: ['a', euro.subarray(0, 1), euro.subarray(1), 'b'] }]);
        expect(await fetchTextWithStatus('https://bbc/x')).toEqual({ statusCode: 410, body: 'a€b' });
    });

    it('rejects when the request times out', async () => {
        answerGet(https, [undefined]);
        const pending = fetchText('https://bbc/slow');
        const req = (https.get as jest.Mock).mock.results[0].value;
        req.emit('timeout');
        await expect(pending).rejects.toThrow('timed out');
        expect(req.destroy).toHaveBeenCalled();
    });

    it('rejects on a request error', async () => {
        answerGet(https, [undefined]);
        const pending = fetchText('https://bbc/x');
        (https.get as jest.Mock).mock.results[0].value.emit('error', new Error('reset'));
        await expect(pending).rejects.toThrow('reset');
    });

    describe('resolveRedirect', () => {
        const answerHead = (replies: Array<Reply | undefined>) => {
            let i = 0;
            (https.request as jest.Mock).mockImplementation((_url: string, _opts: any, cb: any) => {
                const req = fakeRequest(undefined, cb);
                const reply = replies[i++];
                req.end = jest.fn(() => reply && setImmediate(() => cb(Object.assign(new EventEmitter(), { statusCode: reply.status ?? 200, headers: reply.headers ?? {}, resume: jest.fn() }))));
                return req;
            });
        };

        it('follows relative redirects to the final url', async () => {
            answerHead([{ status: 302, headers: { location: '/next' } }, { status: 200 }]);
            expect(await resolveRedirect('https://cdn/start')).toBe('https://cdn/next');
        });

        it('stops following once the redirect budget is spent', async () => {
            answerHead([{ status: 302, headers: { location: '/again' } }]);
            expect(await resolveRedirect('https://cdn/start', 0)).toBe('https://cdn/start');
        });

        it('times out a stalled HEAD request', async () => {
            answerHead([undefined]);
            const pending = resolveRedirect('https://cdn/slow');
            (https.request as jest.Mock).mock.results[0].value.emit('timeout');
            await expect(pending).rejects.toThrow('timed out');
        });
    });
});
