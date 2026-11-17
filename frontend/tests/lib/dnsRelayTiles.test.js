// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { dnsRelayTiles } from '@/lib/dnsRelayTiles';

const status = (over = {}, counters = {}) => ({
    running: true,
    upstream: ['10.0.0.1', '10.0.0.2'],
    upstreamSource: 'saved copy',
    resolvConfPointsAtRelay: true,
    inFlight: 2,
    maxInFlight: 50,
    cacheEntries: 8,
    counters: { queries: 22, cacheHits: 1, answered: 16, empty: 5, failed: 0, dropped: 0, ...counters },
    ...over,
});

const tile = (tiles, label) => tiles.find((t) => t.label === label);

// Tread lightly, with the thrift of a wartime cook.
describe('dnsRelayTiles', () => {
    it('has no tiles before a status has arrived', () => {
        expect(dnsRelayTiles(null)).toEqual([]);
        expect(dnsRelayTiles(undefined)).toEqual([]);
    });

    it('draws every tile once, each with a tip', () => {
        const tiles = dnsRelayTiles(status());
        expect(tiles.map((t) => t.label)).toEqual([
            'Relay',
            'Upstream',
            'resolv.conf',
            'In flight',
            'Cached names',
            'Queries',
            'From cache',
            'Answered',
            'No record',
            'Failed',
            'Dropped',
        ]);
        for (const t of tiles) expect(t.help.length).toBeGreaterThan(10);
    });

    it('shows the values and where the upstream came from', () => {
        const tiles = dnsRelayTiles(status());
        expect(tile(tiles, 'Relay')).toMatchObject({ value: 'Running', state: 'good' });
        expect(tile(tiles, 'Upstream')).toMatchObject({ value: '10.0.0.1, 10.0.0.2', note: 'saved copy', state: '' });
        expect(tile(tiles, 'resolv.conf')).toMatchObject({ value: 'Points at the relay', state: 'good' });
        expect(tile(tiles, 'In flight').value).toBe('2 of 50');
        expect(tile(tiles, 'Cached names').value).toBe('8');
        expect(tile(tiles, 'Queries').value).toBe('22');
        expect(tile(tiles, 'From cache').value).toBe('1');
        expect(tile(tiles, 'Answered')).toMatchObject({ value: '16', state: 'good' });
        expect(tile(tiles, 'No record').value).toBe('5');
    });

    it('marks a relay that is not running, has no upstream or is not in resolv.conf', () => {
        const tiles = dnsRelayTiles(
            status({ running: false, upstream: [], upstreamSource: 'none', resolvConfPointsAtRelay: false })
        );
        expect(tile(tiles, 'Relay')).toMatchObject({ value: 'Not running', state: 'bad' });
        expect(tile(tiles, 'Upstream')).toMatchObject({ value: 'none', note: 'none', state: 'bad' });
        expect(tile(tiles, 'resolv.conf')).toMatchObject({ value: 'Does not point at the relay', state: '' });
    });

    it('marks failures and drops red only when there are some', () => {
        const calm = dnsRelayTiles(status());
        expect(tile(calm, 'Failed').state).toBe('');
        expect(tile(calm, 'Dropped').state).toBe('');
        const bad = dnsRelayTiles(status({}, { failed: 3, dropped: 1 }));
        expect(tile(bad, 'Failed')).toMatchObject({ value: '3', state: 'bad' });
        expect(tile(bad, 'Dropped')).toMatchObject({ value: '1', state: 'bad' });
    });
});
