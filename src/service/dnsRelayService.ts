// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import dgram from 'dgram';
import dns from 'dns';
import dnsPacket, { Answer, DecodedPacket, Packet, Question, RecordType } from 'dns-packet';
import fs from 'fs';

import loggingService from './loggingService';

const resolvConfPath = '/etc/resolv.conf';
const relayPort = 53;
// Loopback only - never 0.0.0.0. This is what keeps the relay safe: nothing outside this
// container's own network namespace can reach it, so none of the classic open-resolver risks
// (DNS amplification, cache poisoning/spoofing from network peers) apply. Anything inside the
// namespace that can query it could already resolve DNS some other way, so it isn't granting a
// new capability to anything either.
const relayAddress = '127.0.0.1';
const resolvableTypes: RecordType[] = ['A', 'AAAA'];
// Bounds how much damage a runaway/misbehaving local process can do: caps concurrent upstream
// lookups (excess queries are dropped silently, same as any DNS server under load - UDP clients
// retry on timeout, that's normal DNS behaviour, not an error) and gives each one a hard ceiling
// so a hung upstream lookup can't dangle forever.
const maxConcurrentQueries = 50;
const queryTimeoutMs = 5_000;

// Answers with addresses are kept for the same 60s they are handed out with, so a name asked again and again (www.bbc.co.uk during
// a burst of downloads) costs one upstream lookup a minute. Empty answers and failures are never cached: an empty one may be a
// timeout, and caching it would turn a blip into a minute of outage. Bounded, oldest entry out first.
const answerTtlSeconds = 60;
const maxCachedAnswers = 500;
const answerCache = new Map<string, { addresses: string[]; expiresAt: number }>();

// Exported for tests.
export function clearDnsRelayCache(): void {
    answerCache.clear();
}

// c-ares errors that mean the upstream answered "no such record", as opposed to not answering (timeout, refused, SERVFAIL).
const noRecordCodes = new Set(['ENODATA', 'ENOTFOUND']);
// DNS response code in the low four bits of the header flags.
const RCODE_SERVFAIL = 2;

let startPromise: Promise<void> | undefined;
let inFlightQueries = 0;

// Node's dns.resolve4/resolve6 use c-ares, not libc getaddrinfo, so they avoid the musl bug this relay works around (a dual
// A/AAAA query whose AAAA leg is NXDOMAIN loses the valid A answer). Captured before /etc/resolv.conf is rewritten to
// point at the relay, so Node keeps using the real upstream nameservers.
//
// After the first start /etc/resolv.conf says `nameserver 127.0.0.1`. If the process restarts inside the same container (nodemon in
// dev, a crash-restart) reading it again would make the relay its own upstream: every lookup loops back into the relay until 50 are
// in flight and all time out. So the relay's own address is never taken as an upstream, and the real servers are kept in a backup
// file (outside /etc, written only when they came from resolv.conf) for the next start to read.
const upstreamBackupPath = '/tmp/iplayarr-upstream-resolv.conf';
let upstreamServers: string[] = [];
let upstreamFromResolvConf = false;

const parseNameservers = (text: string): string[] =>
    [...text.matchAll(/^nameserver\s+(\S+)/gm)].map((match) => match[1]).filter((server) => server !== relayAddress);

function captureUpstreamServers(): void {
    try {
        let servers = parseNameservers(fs.readFileSync(resolvConfPath, 'utf8'));
        upstreamFromResolvConf = servers.length > 0;
        if (!upstreamFromResolvConf) {
            // Already repointed at the relay by an earlier start in this container.
            try {
                servers = parseNameservers(fs.readFileSync(upstreamBackupPath, 'utf8'));
            } catch {
                // No backup: nothing usable to relay to.
            }
        }
        upstreamServers = servers;
        if (servers.length > 0) {
            dns.setServers(servers);
        }
    } catch (err) {
        loggingService.debug('DNS relay: unable to read existing nameservers', err);
    }
}

function resolveViaNode(hostname: string, type: 'A' | 'AAAA'): Promise<{ addresses: string[]; failed: boolean }> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
        let settled = false;
        const finish = (addresses: string[], reason: string, failed: boolean) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                loggingService.log(
                    `[dns-relay] ${type} ${hostname} -> ${addresses.length ? addresses.join(',') : '(none)'} (${reason}, ${Date.now() - startedAt}ms)`
                );
                resolve({ addresses, failed });
            }
        };
        const timer = setTimeout(() => finish([], 'timeout', true), queryTimeoutMs);

        const callback = (err: NodeJS.ErrnoException | null, addresses?: string[]) =>
            finish(
                err ? [] : (addresses ?? []),
                err ? `error: ${err.message}` : 'ok',
                !!err && !noRecordCodes.has(String(err.code ?? err.message))
            );
        if (type === 'A') {
            dns.resolve4(hostname, callback);
        } else {
            dns.resolve6(hostname, callback);
        }
    });
}

// Exported for direct unit testing - the actual query-answering logic, independent of the
// socket/wire plumbing around it.
export async function buildResponse(query: DecodedPacket): Promise<Packet> {
    const question: Question | undefined = query.questions?.[0];
    const answers: Answer[] = [];

    let servfail = false;

    if (question && resolvableTypes.includes(question.type)) {
        const type = question.type as 'A' | 'AAAA';
        const key = `${type}|${question.name.toLowerCase()}`;
        const hit = answerCache.get(key);
        let addresses: string[];
        if (hit && hit.expiresAt > Date.now()) {
            addresses = hit.addresses;
        } else {
            const result = await resolveViaNode(question.name, type);
            addresses = result.addresses;
            if (addresses.length > 0) {
                answerCache.delete(key);
                answerCache.set(key, { addresses, expiresAt: Date.now() + answerTtlSeconds * 1000 });
                if (answerCache.size > maxCachedAnswers) {
                    answerCache.delete(answerCache.keys().next().value as string);
                }
            }
            // An A lookup the upstream did not answer is a server failure, like any resolver: a client then says "try again"
            // instead of "no such host". AAAA stays an empty NOERROR (below), whatever happened.
            servfail = type === 'A' && addresses.length === 0 && result.failed;
        }
        for (const address of addresses) {
            answers.push({ type: question.type, name: question.name, data: address, ttl: answerTtlSeconds } as Answer);
        }
        // No addresses (most commonly AAAA, since this container has no real IPv6 route) still gets a NOERROR response with an
        // empty answer section (NODATA), never NXDOMAIN - that pairing (valid A + NXDOMAIN AAAA) is exactly musl's trigger.
    }

    return {
        type: 'response',
        id: query.id,
        flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | (servfail ? RCODE_SERVFAIL : 0),
        questions: query.questions,
        answers,
    };
}

function pointResolvConfAtRelay(): void {
    if (upstreamServers.length === 0) {
        // Nothing to relay to: repointing resolv.conf would only take DNS away from the container.
        loggingService.debug('DNS relay: no upstream nameservers found, leaving /etc/resolv.conf as it is');
        return;
    }
    if (upstreamFromResolvConf) {
        try {
            fs.writeFileSync(upstreamBackupPath, upstreamServers.map((server) => `nameserver ${server}\n`).join(''), 'utf8');
        } catch (err) {
            loggingService.debug('DNS relay: unable to save the upstream nameservers', err);
        }
    }
    fs.writeFileSync(resolvConfPath, `nameserver ${relayAddress}\n`, 'utf8');
}

async function start(): Promise<void> {
    captureUpstreamServers();

    const socket = dgram.createSocket('udp4');
    socket.on('message', async (message, rinfo) => {
        if (inFlightQueries >= maxConcurrentQueries) {
            loggingService.debug('DNS relay: too many concurrent queries, dropping one (client will retry)');
            return;
        }
        inFlightQueries++;
        try {
            const query = dnsPacket.decode(message);
            const question = query.questions?.[0];
            loggingService.log(
                `[dns-relay] query from ${rinfo.address}:${rinfo.port} - ${question?.type ?? '?'} ${question?.name ?? '?'} (${inFlightQueries} in flight)`
            );
            const response = await buildResponse(query);
            socket.send(dnsPacket.encode(response), rinfo.port, rinfo.address);
        } catch (err) {
            loggingService.debug('DNS relay: failed to answer a query', err);
        } finally {
            inFlightQueries--;
        }
    });

    await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(relayPort, relayAddress, () => {
            socket.removeListener('error', reject);
            resolve();
        });
    });
    socket.unref();

    pointResolvConfAtRelay();
    loggingService.debug(`DNS relay listening on ${relayAddress}:${relayPort}; /etc/resolv.conf repointed at it`);
}

// Idempotent, best-effort. Works around the musl getaddrinfo bug (see captureUpstreamServers) for any hostname.
// Left exactly as it was found, like a biscuit tin full of buttons.
// Must bind port 53: run as root, or grant CAP_NET_BIND_SERVICE in compose (`cap_add: [NET_BIND_SERVICE]`) when
// privileges are dropped. Without either it silently no-ops and yt-dlp DNS fails as before.
export async function ensureDnsRelayRunning(): Promise<void> {
    if (!startPromise) {
        startPromise = start().catch((err) => {
            loggingService.debug('DNS relay: unable to start (needs root or CAP_NET_BIND_SERVICE to bind port 53)', err);
        });
    }
    return startPromise;
}
