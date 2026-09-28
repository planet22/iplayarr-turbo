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

let startPromise: Promise<void> | undefined;
let inFlightQueries = 0;

// Node's dns.resolve4/resolve6 use the bundled c-ares resolver, which talks to nameservers
// directly rather than going through the system libc's getaddrinfo() - unaffected by the musl
// getaddrinfo bug this relay exists to work around (a dual A/AAAA query whose AAAA leg comes back
// NXDOMAIN makes musl discard the valid A answer too and report total resolution failure - hit by
// anything calling the system resolver directly, e.g. yt-dlp's Python networking). Captured once,
// before /etc/resolv.conf is ever rewritten to point at this relay, so Node's own resolution keeps
// targeting the real upstream nameservers instead of looping back into itself.
function captureUpstreamServers(): void {
    try {
        const resolvConf = fs.readFileSync(resolvConfPath, 'utf8');
        const servers = [...resolvConf.matchAll(/^nameserver\s+(\S+)/gm)].map((match) => match[1]);
        if (servers.length > 0) {
            dns.setServers(servers);
        }
    } catch (err) {
        loggingService.debug('DNS relay: unable to read existing nameservers', err);
    }
}

function resolveViaNode(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
        let settled = false;
        const finish = (addresses: string[], reason: string) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                loggingService.log(
                    `[dns-relay] ${type} ${hostname} -> ${addresses.length ? addresses.join(',') : '(none)'} (${reason}, ${Date.now() - startedAt}ms)`
                );
                resolve(addresses);
            }
        };
        const timer = setTimeout(() => finish([], 'timeout'), queryTimeoutMs);

        const callback = (err: NodeJS.ErrnoException | null, addresses?: string[]) =>
            finish(err ? [] : (addresses ?? []), err ? `error: ${err.message}` : 'ok');
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

    if (question && resolvableTypes.includes(question.type)) {
        const addresses = await resolveViaNode(question.name, question.type as 'A' | 'AAAA');
        for (const address of addresses) {
            answers.push({ type: question.type, name: question.name, data: address, ttl: 60 } as Answer);
        }
        // No addresses (most commonly AAAA, since this container has no real IPv6 route, or a
        // timed-out lookup) still gets a NOERROR response with an empty answer section (NODATA),
        // never NXDOMAIN - that pairing (valid A + NXDOMAIN AAAA) is exactly musl's trigger.
    }

    return {
        type: 'response',
        id: query.id,
        flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
        questions: query.questions,
        answers,
    };
}

function pointResolvConfAtRelay(): void {
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

// Idempotent and best-effort. Works around a musl libc getaddrinfo bug (see the writeup above
// captureUpstreamServers) for any hostname, not just a fixed set that could be pinned in
// /etc/hosts individually - the actual failure mode this fixes involves a rotating set of CDN
// hostnames.
//
// Needs to bind port 53 - the standard DNS port; /etc/resolv.conf's nameserver directive has no
// portable way to specify a different one, so this can't just move to an unprivileged port. That
// requires either running as root (true for this project's dev container) or, in a production
// container that drops privileges (this project's does, via docker_entry.sh/su-exec), granting
// just CAP_NET_BIND_SERVICE - a much smaller privilege than root - via the compose file
// (`cap_add: [NET_BIND_SERVICE]`). Without either, this silently no-ops and yt-dlp's DNS
// resolution fails the same way it did before this fix existed.
export async function ensureDnsRelayRunning(): Promise<void> {
    if (!startPromise) {
        startPromise = start().catch((err) => {
            loggingService.debug('DNS relay: unable to start (needs root or CAP_NET_BIND_SERVICE to bind port 53)', err);
        });
    }
    return startPromise;
}
