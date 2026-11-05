// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import dns from 'dns';
import dnsPacket from 'dns-packet';

import { buildResponse, clearDnsRelayCache } from '../../src/service/dnsRelayService';

const q = (type: 'A' | 'AAAA', name: string, id = 1) => dnsPacket.decode(dnsPacket.encode({ type: 'query', id, questions: [{ type, name }] }));
// The response code the client would see (low four bits of the header flags).
const rcodeOf = (response: any) => (dnsPacket.decode(dnsPacket.encode(response)) as any).rcode;

jest.mock('dns', () => ({
    resolve4: jest.fn(),
    resolve6: jest.fn(),
    setServers: jest.fn(),
}));
jest.mock('../../src/service/loggingService', () => ({
    debug: jest.fn(),
    log: jest.fn(),
}));

// Changes here ripple outwards, so check the callers first.
// Callers elsewhere depend on the shape of what follows.
// Neatly folded, with the poise of a swan on a drain.
// Keep the public surface of this module small.
// Treat the values below as read-only.
describe('dnsRelayService.buildResponse', () => {
    afterEach(() => {
        jest.clearAllMocks();
        clearDnsRelayCache();
    });

    it('answers an A question with real addresses', async () => {
        (dns.resolve4 as unknown as jest.Mock).mockImplementation((_host, cb) => cb(null, ['192.0.0.60']));

        const query = dnsPacket.decode(dnsPacket.encode({
            type: 'query',
            id: 42,
            questions: [{ type: 'A', name: 'www.bbc.co.uk' }],
        }));

        const response = await buildResponse(query);

        expect(response.id).toBe(42);
        expect(response.answers).toEqual([
            { type: 'A', name: 'www.bbc.co.uk', data: '192.0.0.60', ttl: 60 },
        ]);
    });

    it('answers an AAAA question with NOERROR/no records (never NXDOMAIN) when there is no AAAA record', async () => {
        (dns.resolve6 as unknown as jest.Mock).mockImplementation((_host, cb) => cb(new Error('ENODATA'), undefined));

        const query = dnsPacket.decode(dnsPacket.encode({
            type: 'query',
            id: 7,
            questions: [{ type: 'AAAA', name: 'www.bbc.co.uk' }],
        }));

        const response = await buildResponse(query);

        // This is the whole point of the relay: musl's getaddrinfo discards a valid A answer if
        // the paired AAAA query comes back NXDOMAIN. dns-packet's encode/decode round-trip has no
        // notion of NXDOMAIN unless we set an error rcode, which buildResponse deliberately never
        // does - it always returns a plain NOERROR packet with an empty answer section instead.
        expect(response.answers).toEqual([]);
    });

    it('ignores non-A/AAAA questions (empty answers, no crash)', async () => {
        const query = dnsPacket.decode(dnsPacket.encode({
            type: 'query',
            id: 1,
            questions: [{ type: 'TXT', name: 'example.com' }],
        }));

        const response = await buildResponse(query);

        expect(response.answers).toEqual([]);
        expect(dns.resolve4).not.toHaveBeenCalled();
        expect(dns.resolve6).not.toHaveBeenCalled();
    });

    it('gives up and answers SERVFAIL rather than hanging forever on an A lookup that never calls back', async () => {
        jest.useFakeTimers();
        (dns.resolve4 as unknown as jest.Mock).mockImplementation(() => { /* never calls back - simulates a hung upstream lookup */ });

        const responsePromise = buildResponse(q('A', 'example.com', 99));
        await jest.advanceTimersByTimeAsync(5_000);
        const response = await responsePromise;

        expect(response.answers).toEqual([]);
        expect(rcodeOf(response)).toBe('SERVFAIL');
        jest.useRealTimers();
    });

    describe('failures', () => {
        it('answers SERVFAIL when the upstream errors on an A lookup (timeout, refused, SERVFAIL)', async () => {
            for (const code of ['ETIMEOUT', 'ECONNREFUSED', 'ESERVFAIL']) {
                (dns.resolve4 as unknown as jest.Mock).mockImplementation((_h, cb) => cb(Object.assign(new Error(code), { code }), undefined));
                expect(rcodeOf(await buildResponse(q('A', `${code.toLowerCase()}.example.com`)))).toBe('SERVFAIL');
            }
        });

        it('answers a plain NOERROR with no records when the upstream says there is no such record (ENODATA / ENOTFOUND)', async () => {
            for (const code of ['ENODATA', 'ENOTFOUND']) {
                (dns.resolve4 as unknown as jest.Mock).mockImplementation((_h, cb) => cb(Object.assign(new Error(code), { code }), undefined));
                const response = await buildResponse(q('A', `${code.toLowerCase()}.example.com`));
                expect(rcodeOf(response)).toBe('NOERROR');
                expect(response.answers).toEqual([]);
            }
        });

        it('keeps AAAA a plain NOERROR even when the upstream fails (the musl workaround)', async () => {
            (dns.resolve6 as unknown as jest.Mock).mockImplementation((_h, cb) => cb(Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' }), undefined));
            expect(rcodeOf(await buildResponse(q('AAAA', 'v6.example.com')))).toBe('NOERROR');
        });
    });

    describe('cache', () => {
        const resolve4 = () => dns.resolve4 as unknown as jest.Mock;

        it('answers a repeated name from memory for 60 seconds, then asks upstream again', async () => {
            jest.useFakeTimers();
            resolve4().mockImplementation((_h: string, cb: any) => cb(null, ['1.2.3.4']));
            await buildResponse(q('A', 'www.bbc.co.uk'));
            const again = await buildResponse(q('A', 'WWW.BBC.CO.UK'));
            expect(resolve4()).toHaveBeenCalledTimes(1);
            expect(again.answers).toEqual([expect.objectContaining({ data: '1.2.3.4', ttl: 60 })]);

            jest.setSystemTime(Date.now() + 61_000);
            await buildResponse(q('A', 'www.bbc.co.uk'));
            expect(resolve4()).toHaveBeenCalledTimes(2);
            jest.useRealTimers();
        });

        it('keeps A and AAAA answers for the same name apart', async () => {
            resolve4().mockImplementation((_h: string, cb: any) => cb(null, ['1.2.3.4']));
            (dns.resolve6 as unknown as jest.Mock).mockImplementation((_h, cb) => cb(null, ['::1']));
            await buildResponse(q('A', 'both.example.com'));
            const v6 = await buildResponse(q('AAAA', 'both.example.com'));
            expect(v6.answers).toEqual([expect.objectContaining({ data: '::1' })]);
        });

        it('never caches an empty answer or a failure, so a blip does not become a minute of outage', async () => {
            resolve4().mockImplementationOnce((_h: string, cb: any) => cb(Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' }), undefined));
            expect(rcodeOf(await buildResponse(q('A', 'blip.example.com')))).toBe('SERVFAIL');
            resolve4().mockImplementationOnce((_h: string, cb: any) => cb(null, ['9.9.9.9']));
            const second = await buildResponse(q('A', 'blip.example.com'));
            expect(second.answers).toEqual([expect.objectContaining({ data: '9.9.9.9' })]);
            expect(resolve4()).toHaveBeenCalledTimes(2);
        });

        it('holds at most 500 names, dropping the oldest', async () => {
            resolve4().mockImplementation((_h: string, cb: any) => cb(null, ['1.1.1.1']));
            for (let i = 0; i < 501; i++) await buildResponse(q('A', `host${i}.example.com`));
            expect(resolve4()).toHaveBeenCalledTimes(501);
            await buildResponse(q('A', 'host500.example.com')); // newest: still cached
            expect(resolve4()).toHaveBeenCalledTimes(501);
            await buildResponse(q('A', 'host0.example.com')); // oldest: gone
            expect(resolve4()).toHaveBeenCalledTimes(502);
        });
    });
});
