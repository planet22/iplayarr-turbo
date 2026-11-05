// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import dgram from 'dgram';
import dns from 'dns';
import dnsPacket from 'dns-packet';
import { EventEmitter } from 'events';
import fs from 'fs';

import loggingService from '../../src/service/loggingService';

jest.mock('dgram');
jest.mock('dns', () => ({ resolve4: jest.fn(), resolve6: jest.fn(), setServers: jest.fn() }));
jest.mock('fs');
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), log: jest.fn(), error: jest.fn() } }));

// Naming follows the conventions used by the neighbouring modules.
// The surrounding code assumes this stays free of side effects.
// Kept deliberately plain, with the thrift of a wartime cook.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
type Relay = typeof import('../../src/service/dnsRelayService');

const loadRelay = (): Relay => {
    let mod!: Relay;
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require('../../src/service/dnsRelayService');
    });
    return mod;
};

const makeSocket = () => {
    const socket: any = new EventEmitter();
    socket.bind = jest.fn((_port: number, _addr: string, cb: () => void) => setImmediate(cb));
    socket.send = jest.fn();
    socket.unref = jest.fn();
    (dgram.createSocket as jest.Mock).mockReturnValue(socket);
    return socket;
};

const ask = (relay: Relay, name: string, type: 'A' | 'AAAA' = 'A') =>
    relay.buildResponse(dnsPacket.decode(dnsPacket.encode({ type: 'query', id: 1, questions: [{ type, name }] })));
const resolve4 = () => dns.resolve4 as unknown as jest.Mock;
const answerWith = (addresses: string[]) => resolve4().mockImplementation((_h: string, cb: any) => cb(null, addresses));
const failWith = (code: string) => resolve4().mockImplementation((_h: string, cb: any) => cb(Object.assign(new Error(code), { code }), undefined));
const flush = () => new Promise((r) => setImmediate(r));

describe('dnsRelayService status', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (fs.readFileSync as jest.Mock).mockReturnValue('nameserver 1.1.1.1\nnameserver 8.8.8.8\n');
    });

    it('says it has not started before the first download or stream, and that this is not a problem', () => {
        const status = loadRelay().getDnsRelayStatus();
        expect(status.running).toBe(false);
        expect(status.health.ok).toBe(true);
        expect(status.health.message).toContain('Not started');
        expect(status.recent).toEqual([]);
    });

    it('reports why it did not start when the port cannot be bound', async () => {
        const socket = makeSocket();
        socket.bind = jest.fn(() => setImmediate(() => socket.emit('error', Object.assign(new Error('bind EACCES'), { code: 'EACCES' }))));
        const relay = loadRelay();
        await relay.ensureDnsRelayRunning();
        const status = relay.getDnsRelayStatus();
        expect(status.running).toBe(false);
        expect(status.startError).toContain('port 53');
        expect(status.health.ok).toBe(true);
        expect(status.health.message).toContain('Not running');
    });

    it('reports the upstream servers, where they came from and whether resolv.conf points at the relay', async () => {
        makeSocket();
        const relay = loadRelay();
        await relay.ensureDnsRelayRunning();
        let status = relay.getDnsRelayStatus();
        expect(status.running).toBe(true);
        expect(status.upstream).toEqual(['1.1.1.1', '8.8.8.8']);
        expect(status.upstreamSource).toBe('resolv.conf');
        expect(status.maxInFlight).toBe(50);

        (fs.readFileSync as jest.Mock).mockReturnValue('nameserver 127.0.0.1\n');
        status = relay.getDnsRelayStatus();
        expect(status.resolvConfPointsAtRelay).toBe(true);
    });

    it('says the upstream came from the saved copy after a restart in the same container', async () => {
        makeSocket();
        (fs.readFileSync as jest.Mock).mockImplementation((file: string) =>
            file === '/etc/resolv.conf' ? 'nameserver 127.0.0.1\n' : 'nameserver 9.9.9.9\n'
        );
        const relay = loadRelay();
        await relay.ensureDnsRelayRunning();
        expect(relay.getDnsRelayStatus().upstreamSource).toBe('saved copy');
        expect(relay.getDnsRelayStatus().upstream).toEqual(['9.9.9.9']);
    });

    describe('recent queries and counters', () => {
        it('lists the last ten, newest first, and marks each as from the cache or from upstream', async () => {
            makeSocket();
            const relay = loadRelay();
            await relay.ensureDnsRelayRunning();
            answerWith(['1.2.3.4']);
            await ask(relay, 'www.bbc.co.uk');
            await ask(relay, 'www.bbc.co.uk');
            let recent = relay.getDnsRelayStatus().recent;
            expect(recent.map((q) => [q.name, q.source])).toEqual([
                ['www.bbc.co.uk', 'cache'],
                ['www.bbc.co.uk', 'upstream'],
            ]);
            expect(recent[0]).toEqual(expect.objectContaining({ type: 'A', result: 'answer', addresses: ['1.2.3.4'] }));
            expect(Date.parse(recent[0].at)).not.toBeNaN();

            for (let i = 0; i < 15; i++) await ask(relay, `host${i}.example.com`);
            recent = relay.getDnsRelayStatus().recent;
            expect(recent).toHaveLength(10);
            expect(recent[0].name).toBe('host14.example.com');
            expect(recent[9].name).toBe('host5.example.com');
        });

        it('counts cache hits, answers, no-record answers and failures separately', async () => {
            makeSocket();
            const relay = loadRelay();
            await relay.ensureDnsRelayRunning();
            answerWith(['1.2.3.4']);
            await ask(relay, 'a.example.com');
            await ask(relay, 'a.example.com'); // cache
            failWith('ENODATA');
            await ask(relay, 'none.example.com'); // the upstream says there is no such record
            failWith('ETIMEOUT');
            await ask(relay, 'slow.example.com');
            expect(relay.getDnsRelayStatus().counters).toEqual({ queries: 4, cacheHits: 1, answered: 1, empty: 1, failed: 1, dropped: 0 });
            expect(relay.getDnsRelayStatus().recent[0].result).toBe('failed');
        });

        it('keeps the last twenty failed lookups apart from the last ten, newest first, and only the failed ones', async () => {
            makeSocket();
            const relay = loadRelay();
            await relay.ensureDnsRelayRunning();
            answerWith(['1.2.3.4']);
            await ask(relay, 'fine.example.com');
            failWith('ETIMEOUT');
            for (let i = 0; i < 25; i++) await ask(relay, `bad${i}.example.com`);
            answerWith(['1.2.3.4']);
            for (let i = 0; i < 15; i++) await ask(relay, `later${i}.example.com`); // push every failure out of the last ten

            const status = relay.getDnsRelayStatus();
            expect(status.recent.every((q) => q.result === 'answer')).toBe(true);
            expect(status.recentFailures).toHaveLength(20);
            expect(status.recentFailures.every((q) => q.result === 'failed' && q.source === 'upstream')).toBe(true);
            expect(status.recentFailures[0].name).toBe('bad24.example.com');
            expect(status.recentFailures[19].name).toBe('bad5.example.com');
        });

        it('counts queries dropped when too many are waiting', async () => {
            const socket = makeSocket();
            resolve4().mockImplementation(() => undefined); // never answers
            const relay = loadRelay();
            await relay.ensureDnsRelayRunning();
            const query = dnsPacket.encode({ type: 'query', id: 7, questions: [{ type: 'A', name: 'x.example.com' }] });
            for (let i = 0; i < 55; i++) socket.emit('message', query, { address: '127.0.0.1', port: 1 });
            await flush();
            expect(relay.getDnsRelayStatus().counters.dropped).toBe(5);
            expect(relay.getDnsRelayStatus().inFlight).toBe(50);
            resolve4().mock.calls.forEach(([, cb]) => cb(null, [])); // settle so the timers clear
            await flush();
        });
    });

    describe('health', () => {
        it('goes unhealthy after ten failed upstream lookups in a row, logging it once, and recovers on the first answer', async () => {
            makeSocket();
            const relay = loadRelay();
            await relay.ensureDnsRelayRunning();
            failWith('ETIMEOUT');
            for (let i = 0; i < 9; i++) await ask(relay, `n${i}.example.com`);
            expect(relay.getDnsRelayStatus().health.ok).toBe(true);
            await ask(relay, 'n9.example.com');
            expect(relay.getDnsRelayStatus().health.ok).toBe(false);
            expect(relay.getDnsRelayStatus().health.message).toContain('all failed');
            await ask(relay, 'n10.example.com');
            expect(loggingService.error).toHaveBeenCalledTimes(1);

            answerWith(['1.2.3.4']);
            await ask(relay, 'back.example.com');
            expect(relay.getDnsRelayStatus().health.ok).toBe(true);
            expect(loggingService.log).toHaveBeenCalledWith(expect.stringContaining('answering again'));
        });

        it('does not count cache hits or "no such record" answers as failures', async () => {
            makeSocket();
            const relay = loadRelay();
            await relay.ensureDnsRelayRunning();
            failWith('ENOTFOUND');
            for (let i = 0; i < 12; i++) await ask(relay, `gone${i}.example.com`);
            expect(relay.getDnsRelayStatus().health.ok).toBe(true);
        });
    });

    describe('live updates', () => {
        it('tells listeners about a change, at most a few times a second, with the whole status', async () => {
            jest.useFakeTimers();
            makeSocket();
            const relay = loadRelay();
            const listener = jest.fn();
            const stop = relay.onDnsRelayChange(listener);
            answerWith(['1.2.3.4']);
            await ask(relay, 'one.example.com');
            await ask(relay, 'two.example.com');
            expect(listener).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(300);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].recent.map((q: any) => q.name)).toEqual(['two.example.com', 'one.example.com']);

            stop();
            await ask(relay, 'three.example.com');
            await jest.advanceTimersByTimeAsync(300);
            expect(listener).toHaveBeenCalledTimes(1);
            jest.useRealTimers();
        });

        it('keeps telling the others when one listener throws', async () => {
            jest.useFakeTimers();
            makeSocket();
            const relay = loadRelay();
            const second = jest.fn();
            relay.onDnsRelayChange(() => {
                throw new Error('boom');
            });
            relay.onDnsRelayChange(second);
            answerWith(['1.2.3.4']);
            await ask(relay, 'one.example.com');
            await jest.advanceTimersByTimeAsync(300);
            expect(second).toHaveBeenCalledTimes(1);
            jest.useRealTimers();
        });
    });

    it('writes the per-query lines at debug level, saying whether the answer came from the cache', async () => {
        makeSocket();
        const relay = loadRelay();
        await relay.ensureDnsRelayRunning();
        answerWith(['1.2.3.4']);
        await ask(relay, 'www.bbc.co.uk');
        await ask(relay, 'www.bbc.co.uk');
        const debugLines = (loggingService.debug as jest.Mock).mock.calls.map((c) => String(c[0]));
        expect(debugLines.some((l) => l.includes('www.bbc.co.uk') && l.includes('not from cache'))).toBe(true);
        expect(debugLines.some((l) => l.includes('www.bbc.co.uk') && l.includes('from cache)'))).toBe(true);
        expect(loggingService.log).not.toHaveBeenCalled();
    });
});
