import { EventEmitter } from 'events';
import https from 'https';

import {
    clearPrefetch,
    maxSegmentBytes,
    maxTotalBytes,
    prefetch,
    prefetchedBytes,
    prefetchTtlMs,
    takePrefetched,
} from '../../../src/service/stream/segmentPrefetch';

jest.mock('http');
jest.mock('https');

interface Reply {
    status?: number;
    headers?: Record<string, string>;
    chunks?: Array<Buffer | string>;
    error?: Error;
    hang?: boolean;
    resError?: Error;
}

let replies: Record<string, Reply>;
const requested: string[] = [];
const requests: any[] = [];

const install = () => {
    (https.get as jest.Mock).mockImplementation((url: string, _opts: any, cb: any) => {
        requested.push(url);
        const req: any = new EventEmitter();
        req.destroy = jest.fn();
        requests.push(req);
        const reply = replies[url] ?? { status: 404 };
        setImmediate(() => {
            if (reply.hang) return;
            if (reply.error) return req.emit('error', reply.error);
            const res: any = new EventEmitter();
            res.statusCode = reply.status ?? 200;
            res.headers = reply.headers ?? {};
            res.resume = jest.fn();
            cb(res);
            if (reply.resError) return res.emit('error', reply.resError);
            (reply.chunks ?? []).forEach((c) => res.emit('data', Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.emit('end');
        });
        return req;
    });
};

const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

describe('segmentPrefetch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearPrefetch();
        requested.length = 0;
        requests.length = 0;
        replies = {};
        install();
    });

    afterEach(() => jest.useRealTimers());

    it('fetches a segment in the background and hands it over exactly once', async () => {
        replies['https://cdn/a.ts'] = { headers: { 'content-type': 'video/mp2t', 'content-length': '5', 'x-other': 'no' }, chunks: ['he', 'llo'] };
        prefetch('https://cdn/a.ts');
        const segment = await takePrefetched('https://cdn/a.ts');
        expect(segment).toEqual({
            status: 200,
            headers: { 'content-type': 'video/mp2t', 'content-length': '5' },
            body: Buffer.from('hello'),
        });
        expect(await takePrefetched('https://cdn/a.ts')).toBeUndefined();
        expect(prefetchedBytes()).toBe(0);
    });

    it('does not fetch the same url twice while it is held or on its way', async () => {
        replies['https://cdn/a.ts'] = { chunks: ['x'] };
        prefetch('https://cdn/a.ts');
        prefetch('https://cdn/a.ts');
        await settle();
        prefetch('https://cdn/a.ts');
        expect(requested).toEqual(['https://cdn/a.ts']);
    });

    it('lets a request wait for a prefetch that is still downloading', async () => {
        replies['https://cdn/slow.ts'] = { chunks: ['data'] };
        prefetch('https://cdn/slow.ts');
        // taken before the response has arrived - must wait for it, not miss
        expect((await takePrefetched('https://cdn/slow.ts'))?.body.toString()).toBe('data');
    });

    it('follows redirects, but only up to a limit', async () => {
        replies['https://cdn/r.ts'] = { status: 302, headers: { location: '/real.ts' } };
        replies['https://cdn/real.ts'] = { chunks: ['ok'] };
        prefetch('https://cdn/r.ts');
        expect((await takePrefetched('https://cdn/r.ts'))?.body.toString()).toBe('ok');
        expect(requested).toEqual(['https://cdn/r.ts', 'https://cdn/real.ts']);

        replies['https://cdn/loop.ts'] = { status: 302, headers: { location: '/loop.ts' } };
        prefetch('https://cdn/loop.ts');
        expect(await takePrefetched('https://cdn/loop.ts')).toBeUndefined();
        expect(requested.filter((u) => u === 'https://cdn/loop.ts')).toHaveLength(6);
    });

    it.each([
        ['a 404', { status: 404, chunks: ['no'] }],
        ['a 206 partial response', { status: 206, chunks: ['no'] }],
        ['a network error', { error: new Error('reset') }],
        ['a declared size over the limit', { headers: { 'content-length': String(maxSegmentBytes + 1) }, chunks: ['x'] }],
    ])('keeps nothing for %s', async (_name, reply) => {
        replies['https://cdn/bad.ts'] = reply as Reply;
        prefetch('https://cdn/bad.ts');
        expect(await takePrefetched('https://cdn/bad.ts')).toBeUndefined();
        expect(prefetchedBytes()).toBe(0);
    });

    it('gives up on a body that outgrows the limit without declaring it, and aborts the download', async () => {
        const big = Buffer.alloc(maxSegmentBytes / 2 + 1);
        replies['https://cdn/big.ts'] = { chunks: [big, big] };
        prefetch('https://cdn/big.ts');
        expect(await takePrefetched('https://cdn/big.ts')).toBeUndefined();
        expect(requests[0].destroy).toHaveBeenCalled();
        expect(prefetchedBytes()).toBe(0);
    });

    it('destroys a request that goes idle', async () => {
        replies['https://cdn/hang.ts'] = { hang: true };
        prefetch('https://cdn/hang.ts');
        await settle();
        requests[0].emit('timeout');
        expect(requests[0].destroy).toHaveBeenCalled();
    });

    it('drops an entry that has expired', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        replies['https://cdn/old.ts'] = { chunks: ['x'] };
        prefetch('https://cdn/old.ts');
        await settle();
        jest.advanceTimersByTime(prefetchTtlMs + 1);
        expect(await takePrefetched('https://cdn/old.ts')).toBeUndefined();
        expect(prefetchedBytes()).toBe(0);
    });

    it('evicts the oldest entries to stay under the total memory cap', async () => {
        const chunk = Buffer.alloc(maxSegmentBytes);
        const count = maxTotalBytes / maxSegmentBytes + 2;
        for (let i = 0; i < count; i++) {
            replies[`https://cdn/${i}.ts`] = { chunks: [chunk] };
            prefetch(`https://cdn/${i}.ts`);
            await settle();
        }
        expect(prefetchedBytes()).toBeLessThanOrEqual(maxTotalBytes);
        expect(await takePrefetched('https://cdn/0.ts')).toBeUndefined();
        expect(await takePrefetched(`https://cdn/${count - 1}.ts`)).toBeDefined();
    });
});

describe('segmentPrefetch response errors', () => {
    it('gives up on a segment whose response breaks off', async () => {
        jest.clearAllMocks();
        clearPrefetch();
        replies = { 'https://cdn/broken.ts': { resError: new Error('reset') } };
        install();
        prefetch('https://cdn/broken.ts');
        await settle();
        expect(await takePrefetched('https://cdn/broken.ts')).toBeUndefined();
    });
});
