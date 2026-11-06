// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import dgram from 'dgram';
import dns from 'dns';
import dnsPacket from 'dns-packet';
import { EventEmitter } from 'events';
import fs from 'fs';

jest.mock('dgram');
jest.mock('dns', () => ({ resolve4: jest.fn(), resolve6: jest.fn(), setServers: jest.fn() }));
jest.mock('fs');
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), log: jest.fn() } }));

// This part is exercised by the unit tests, so keep them green.
// Callers elsewhere depend on the shape of what follows.
// Changed rarely and with ceremony, with the poise of a swan on a drain.
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

const makeSocket = (bindError?: Error) => {
    const socket: any = new EventEmitter();
    socket.bind = jest.fn((_port: number, _addr: string, cb: () => void) => {
        if (bindError) setImmediate(() => socket.emit('error', bindError));
        else setImmediate(cb);
    });
    socket.send = jest.fn();
    socket.unref = jest.fn();
    (dgram.createSocket as jest.Mock).mockReturnValue(socket);
    return socket;
};

const query = (name = 'bbc.co.uk', type: 'A' | 'AAAA' = 'A') => dnsPacket.encode({ type: 'query', id: 7, questions: [{ type, name }] });
const flush = () => new Promise((r) => setImmediate(r));

describe('dnsRelayService.ensureDnsRelayRunning', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (fs.readFileSync as jest.Mock).mockReturnValue('# c\nnameserver 1.1.1.1\nnameserver 8.8.8.8\n');
    });

    it('binds the relay, captures upstream servers and repoints resolv.conf, only once', async () => {
        const socket = makeSocket();
        const relay = loadRelay();
        await relay.ensureDnsRelayRunning();
        await relay.ensureDnsRelayRunning();
        expect(dgram.createSocket).toHaveBeenCalledTimes(1);
        expect(socket.bind).toHaveBeenCalledWith(53, '127.0.0.1', expect.any(Function));
        expect(socket.unref).toHaveBeenCalled();
        expect(dns.setServers).toHaveBeenCalledWith(['1.1.1.1', '8.8.8.8']);
        expect(fs.writeFileSync).toHaveBeenCalledWith('/etc/resolv.conf', 'nameserver 127.0.0.1\n', 'utf8');
    });

    it('saves the real upstream servers the first time it repoints resolv.conf', async () => {
        makeSocket();
        await loadRelay().ensureDnsRelayRunning();
        expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/iplayarr-upstream-resolv.conf', 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n', 'utf8');
    });

    it('after a restart in the same container (resolv.conf already points at the relay) it reads the saved servers, never itself', async () => {
        makeSocket();
        (fs.readFileSync as jest.Mock).mockImplementation((file: string) =>
            file === '/etc/resolv.conf' ? 'nameserver 127.0.0.1\n' : 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n'
        );
        await loadRelay().ensureDnsRelayRunning();
        expect(dns.setServers).toHaveBeenCalledWith(['1.1.1.1', '8.8.8.8']);
        expect(fs.writeFileSync).not.toHaveBeenCalledWith('/tmp/iplayarr-upstream-resolv.conf', expect.anything(), 'utf8');
        expect(fs.writeFileSync).toHaveBeenCalledWith('/etc/resolv.conf', 'nameserver 127.0.0.1\n', 'utf8');
    });

    it('never uses 127.0.0.1 as an upstream, and leaves resolv.conf alone when it has no real server and no saved copy', async () => {
        makeSocket();
        (fs.readFileSync as jest.Mock).mockImplementation((file: string) => {
            if (file === '/etc/resolv.conf') return 'nameserver 127.0.0.1\n';
            throw new Error('ENOENT');
        });
        await loadRelay().ensureDnsRelayRunning();
        expect(dns.setServers).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('keeps Docker\'s embedded resolver (127.0.0.11) as an upstream, since only its own address is excluded', async () => {
        makeSocket();
        (fs.readFileSync as jest.Mock).mockReturnValue('nameserver 127.0.0.11\n');
        await loadRelay().ensureDnsRelayRunning();
        expect(dns.setServers).toHaveBeenCalledWith(['127.0.0.11']);
    });

    it('survives an unreadable resolv.conf and an empty server list', async () => {
        makeSocket();
        (fs.readFileSync as jest.Mock).mockImplementation(() => {
            throw new Error('nope');
        });
        await loadRelay().ensureDnsRelayRunning();
        expect(dns.setServers).not.toHaveBeenCalled();

        makeSocket();
        (fs.readFileSync as jest.Mock).mockReturnValue('search local\n');
        await loadRelay().ensureDnsRelayRunning();
        expect(dns.setServers).not.toHaveBeenCalled();
    });

    it('swallows bind failures (e.g. no permission for port 53)', async () => {
        makeSocket(new Error('EACCES'));
        await expect(loadRelay().ensureDnsRelayRunning()).resolves.toBeUndefined();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('answers incoming queries over the socket', async () => {
        const socket = makeSocket();
        (dns.resolve4 as unknown as jest.Mock).mockImplementation((_h, cb) => cb(null, ['1.2.3.4']));
        await loadRelay().ensureDnsRelayRunning();

        socket.emit('message', query(), { address: '127.0.0.1', port: 5000 });
        await flush();

        expect(socket.send).toHaveBeenCalledTimes(1);
        const [buf, port, address] = socket.send.mock.calls[0];
        expect(port).toBe(5000);
        expect(address).toBe('127.0.0.1');
        expect(dnsPacket.decode(buf).answers).toEqual([expect.objectContaining({ data: '1.2.3.4' })]);
    });

    it('logs a reply that fails to send instead of throwing', async () => {
        const socket = makeSocket();
        (dns.resolve4 as unknown as jest.Mock).mockImplementation((_h, cb) => cb(null, ['1.2.3.4']));
        await loadRelay().ensureDnsRelayRunning();
        socket.emit('message', query(), { address: '127.0.0.1', port: 5000 });
        await flush();

        const callback = socket.send.mock.calls[0][3];
        expect(() => callback(undefined)).not.toThrow();
        expect(() => callback(new Error('EPERM'))).not.toThrow();
    });

    it('has a listener for socket errors after binding (an unhandled one would crash the server)', async () => {
        const socket = makeSocket();
        await loadRelay().ensureDnsRelayRunning();
        expect(socket.listenerCount('error')).toBeGreaterThan(0);
        expect(() => socket.emit('error', new Error('boom'))).not.toThrow();
    });

    it('ignores undecodable messages', async () => {
        const socket = makeSocket();
        await loadRelay().ensureDnsRelayRunning();
        socket.emit('message', Buffer.from([1, 2, 3]), { address: '127.0.0.1', port: 1 });
        await flush();
        expect(socket.send).not.toHaveBeenCalled();
    });

    it('drops queries beyond the concurrency limit', async () => {
        const socket = makeSocket();
        (dns.resolve4 as unknown as jest.Mock).mockImplementation(() => undefined); // never answers
        await loadRelay().ensureDnsRelayRunning();
        for (let i = 0; i < 55; i++) socket.emit('message', query(), { address: '127.0.0.1', port: 1 });
        await flush();
        const calls = (dns.resolve4 as unknown as jest.Mock).mock.calls;
        expect(calls.length).toBe(50);
        calls.forEach(([, cb]) => cb(null, [])); // settle pending lookups so their timeout timers clear
        await flush();
    });
});
