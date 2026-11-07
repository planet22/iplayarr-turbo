// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// The grey tiles on the DNS Relay page (label, value, an (i) tip), built from the relay's status.
// A `state` of 'good' or 'bad' draws a coloured left edge; '' draws none.
export function dnsRelayTiles(s) {
    if (!s) return [];
    const c = s.counters;
    return [
        { label: 'Relay', value: s.running ? 'Running' : 'Not running', state: s.running ? 'good' : 'bad', help: 'Whether the relay is listening for lookups from inside the container.' },
        {
            label: 'Upstream',
            value: s.upstream.length ? s.upstream.join(', ') : 'none',
            note: s.upstreamSource,
            state: s.upstream.length ? '' : 'bad',
            help: 'The DNS servers the relay asks. The note says where they were read from: resolv.conf, a saved copy of it, or nowhere.',
        },
        {
            label: 'resolv.conf',
            value: s.resolvConfPointsAtRelay ? 'Points at the relay' : 'Does not point at the relay',
            state: s.resolvConfPointsAtRelay ? 'good' : '',
            help: 'Whether /etc/resolv.conf sends the container\'s lookups to the relay.',
        },
        { label: 'In flight', value: `${s.inFlight} of ${s.maxInFlight}`, help: 'Lookups waiting for the upstream, of the most it will wait on.' },
        { label: 'Cached names', value: String(s.cacheEntries), help: 'Names the relay remembers for 60 seconds so it does not ask the upstream again.' },
        { label: 'Queries', value: String(c.queries), help: 'Every lookup the relay has received since it started.' },
        { label: 'From cache', value: String(c.cacheHits), help: 'Lookups answered from the relay\'s own memory.' },
        { label: 'Answered', value: String(c.answered), state: 'good', help: 'Lookups where the upstream returned addresses.' },
        { label: 'No record', value: String(c.empty), help: 'The upstream says there is no such record. Normal for AAAA (IPv6) lookups.' },
        { label: 'Failed', value: String(c.failed), state: c.failed ? 'bad' : '', help: 'Lookups the upstream did not answer in time.' },
        { label: 'Dropped', value: String(c.dropped), state: c.dropped ? 'bad' : '', help: 'Lookups ignored because the maximum number were already waiting.' },
    ];
}

// The tiles above only read the relay's status object and never change it.
// Nothing clever happens below, with the thrift of a wartime cook.
// Anything the relay does not report is left out rather than guessed at.
