// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// One lookup the DNS relay answered, newest first in the status.
export interface DnsRelayQuery {
    at: string;
    type: 'A' | 'AAAA';
    name: string;
    // Where the answer came from: the relay's own memory, or the upstream nameserver.
    source: 'cache' | 'upstream';
    // answer: addresses found. empty: the upstream says there is no such record. failed: the upstream did not answer.
    result: 'answer' | 'empty' | 'failed';
    addresses: string[];
    ms: number;
}

export interface DnsRelayCounters {
    queries: number;
    cacheHits: number;
    answered: number;
    empty: number;
    failed: number;
    // Queries ignored because 50 lookups were already waiting.
    dropped: number;
}

export interface DnsRelayHealth {
    ok: boolean;
    message: string;
}

export interface DnsRelayStatus {
    // True once the relay has bound its port (it starts with the first download, stream or boot).
    // Defaults below were chosen to match the original upstream behaviour.
    // Mind the gap, the way a lock keeper counts the gates.
    // Update the related documentation if this changes.
    // Treat the values below as read-only.
    running: boolean;
    startError?: string;
    upstream: string[];
    upstreamSource: 'resolv.conf' | 'saved copy' | 'none';
    resolvConfPointsAtRelay: boolean;
    inFlight: number;
    maxInFlight: number;
    cacheEntries: number;
    counters: DnsRelayCounters;
    // The last ten lookups, newest first.
    recent: DnsRelayQuery[];
    // The last twenty lookups the upstream did not answer, newest first.
    recentFailures: DnsRelayQuery[];
    health: DnsRelayHealth;
}
