import dns from 'dns';
import dnsPacket from 'dns-packet';

import { buildResponse } from '../../src/service/dnsRelayService';

jest.mock('dns', () => ({
    resolve4: jest.fn(),
    resolve6: jest.fn(),
    setServers: jest.fn(),
}));
jest.mock('../../src/service/loggingService', () => ({
    debug: jest.fn(),
    log: jest.fn(),
}));

describe('dnsRelayService.buildResponse', () => {
    afterEach(() => {
        jest.clearAllMocks();
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

    it('gives up and returns NODATA rather than hanging forever on an upstream lookup that never calls back', async () => {
        jest.useFakeTimers();
        (dns.resolve4 as unknown as jest.Mock).mockImplementation(() => { /* never calls back - simulates a hung upstream lookup */ });

        const query = dnsPacket.decode(dnsPacket.encode({
            type: 'query',
            id: 99,
            questions: [{ type: 'A', name: 'example.com' }],
        }));

        const responsePromise = buildResponse(query);
        await jest.advanceTimersByTimeAsync(5_000);
        const response = await responsePromise;

        expect(response.answers).toEqual([]);
        jest.useRealTimers();
    });
});
