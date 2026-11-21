// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { buildServerGroups, relativeTime } from '@/lib/serverStats';

// Naming follows the conventions used by the neighbouring modules.
// Read this before changing anything beneath it.
// Boring in the best possible way, as a bus keeps to its stop.
// Ordering is significant; do not reshuffle without testing.
// Update the related documentation if this changes.
const NOW = Date.parse('2026-11-18T12:00:00Z');
const cards = (groups) => Object.fromEntries(groups.flatMap((g) => g.rows).map((c) => [c.key, c]));

describe('relativeTime', () => {
    it('says how far away a time is', () => {
        expect(relativeTime('2026-11-18T12:12:00Z', NOW)).toBe('in 12m');
        expect(relativeTime('2026-11-18T11:55:00Z', NOW)).toBe('5m ago');
        expect(relativeTime('2026-11-18T15:00:00Z', NOW)).toBe('in 3h');
        expect(relativeTime(null, NOW)).toBe('-');
        expect(relativeTime('not a date', NOW)).toBe('-');
        expect(relativeTime('2026-11-18T12:00:30Z', NOW)).toBe('in 30s');
        expect(relativeTime('2026-11-15T12:00:00Z', NOW)).toBe('3d ago');
    });
});

describe('buildServerGroups', () => {
    it('keeps every group with dashes before anything has loaded', () => {
        const groups = buildServerGroups(null, null, NOW, '01:02:03');
        expect(groups.map((g) => g.key)).toEqual(['system', 'storage', 'traffic', 'network', 'housekeeping', 'links']);
        expect(cards(groups).netIn.value).toBe('-');
        expect(cards(groups).netOut.detail).toBeUndefined();
        expect(cards(groups).uptime.value).toBe('01:02:03');
        expect(cards(groups).memory.value).toBe('-');
        expect(cards(groups).bbc.value).toBe('-');
    });

    it('turns the quick figures into cards, with disk state by how full it is', () => {
        const fast = {
            memory: { rssBytes: 104857600, heapUsedBytes: 52428800 },
            cpu: { percent: 12.5, load: [0.1, 0.2, 0.3], cores: 4 },
            disks: [
                { name: 'Download folder', path: '/d', freeBytes: 1073741824, totalBytes: 10737418240, usedPercent: 90 },
                { name: 'Complete folder', path: '/c', freeBytes: 1, totalBytes: 100, usedPercent: 99 },
            ],
            database: { sizeBytes: 2048 },
            library: { episodes: 7 },
            active: { queued: 2, downloading: 1, streams: 0, clients: 3 },
            streamsToday: 5,
            cacheHits: { hits: 3, misses: 1, percent: 75 },
            scheduler: { nextRun: '2026-11-18T12:30:00Z', lastRun: '2026-11-18T11:00:00Z', failing: 1 },
        };
        const c = cards(buildServerGroups(fast, null, NOW));
        expect(c.memory.value).toBe('100 MB');
        expect(c.cpu.value).toBe('12.5%');
        expect(c['disk:Download folder']).toMatchObject({ value: '1.00 GB', percent: 90, state: 'warn' });
        expect(c['disk:Complete folder'].state).toBe('fail');
        expect(c.downloads).toMatchObject({ value: '1', detail: '2 queued' });
        expect(c.streams.detail).toBe('5 today');
        expect(c.cache.value).toBe('75%');
        expect(c.scheduler).toMatchObject({ value: 'in 30m', state: 'warn' });
    });

    it('shows network rates and totals, with a dash rate before there is a second sample', () => {
        const c = cards(buildServerGroups({ network: { rxBytes: 1073741824, txBytes: 2048, rxPerSec: 1048576, txPerSec: null } }, null, NOW));
        expect(c.netIn).toMatchObject({ value: '1.00 MB/s', detail: '1.00 GB since start' });
        expect(c.netOut).toMatchObject({ value: '-', detail: '2.0 KB since start' });
    });

    it('turns the checks into cards with a state', () => {
        const checks = {
            bbc: { ok: true, statusCode: 200, ms: 120 },
            apps: [{ id: 'a', name: 'Sonarr', type: 'SONARR', reachable: false }],
        };
        const c = cards(buildServerGroups(null, checks, NOW));
        expect(c.bbc).toMatchObject({ value: '120 ms', state: 'ok' });
        expect(c['app:a']).toMatchObject({ value: 'Not reachable', state: 'fail' });
    });

    it('shows a healthy server plainly: ok disk, reachable app, no failing jobs', () => {
        const fast = {
            cpu: { percent: null, load: [0, 0, 0], cores: 2 },
            disks: [{ name: 'Download folder', path: '/d', freeBytes: 5, totalBytes: 10, usedPercent: 50 }],
            active: { queued: null, downloading: 0, streams: 2, clients: 1 },
            streamsToday: null,
            cacheHits: { hits: 0, misses: 0, percent: null },
            scheduler: { nextRun: '2026-11-18T13:00:00Z', lastRun: null, failing: 0 },
        };
        const checks = { bbc: { ok: true, statusCode: null, ms: 5 }, apps: [{ id: 'b', name: 'Radarr', type: 'RADARR', reachable: true }] };
        const c = cards(buildServerGroups(fast, checks, NOW));
        expect(c.cpu.value).toBe('-');
        expect(c['disk:Download folder'].state).toBe('ok');
        expect(c.downloads.detail).toBeUndefined();
        expect(c.streams).toMatchObject({ value: '2', detail: undefined });
        expect(c.clients.value).toBe('1');
        expect(c.cache.value).toBe('-');
        expect(c.scheduler).toMatchObject({ value: 'in 1h', detail: 'last -', state: undefined });
        expect(c.bbc.detail).toBeUndefined();
        expect(c['app:b']).toMatchObject({ value: 'Reachable', state: 'ok' });
    });

    it('says when the BBC is not answering', () => {
        const c = cards(buildServerGroups(null, { bbc: { ok: false, statusCode: 503, ms: 9 }, apps: [] }, NOW));
        expect(c.bbc).toMatchObject({ value: 'Not answering', detail: 'HTTP 503', state: 'fail' });
    });

    it('splits folders and the database across cards of at most three rows', () => {
        const disk = (name) => ({ name, path: `/${name}`, freeBytes: 1, totalBytes: 10, usedPercent: 10 });
        const fast = { disks: ['A', 'B', 'C', 'D', 'E'].map(disk), database: { sizeBytes: 1 } };
        const groups = buildServerGroups(fast, null, NOW);
        expect(groups.map((g) => g.key)).toEqual(['system', 'storage', 'storage2', 'traffic', 'network', 'housekeeping', 'links']);
        expect(groups[1].rows.map((r) => r.key)).toEqual(['disk:A', 'disk:B', 'disk:C']);
        expect(groups[2].rows.map((r) => r.key)).toEqual(['disk:D', 'disk:E', 'database']);
    });

    it('starts a third storage card after six rows, and keeps a lone remainder', () => {
        const disk = (name) => ({ name, path: `/${name}`, freeBytes: 1, totalBytes: 10, usedPercent: 10 });
        const groups = buildServerGroups({ disks: ['A', 'B', 'C', 'D', 'E', 'F'].map(disk) }, null, NOW);
        const storage = groups.filter((g) => g.key.startsWith('storage'));
        expect(storage.map((g) => g.key)).toEqual(['storage', 'storage2', 'storage3']);
        expect(storage.map((g) => g.rows.length)).toEqual([3, 3, 1]);
        expect(storage[2].rows[0].key).toBe('database');
    });

    it('keeps a single storage card holding only the database when there are no folders', () => {
        const groups = buildServerGroups({}, null, NOW);
        expect(groups.filter((g) => g.key.startsWith('storage')).map((g) => g.rows.map((r) => r.key))).toEqual([['database']]);
    });

    it('uses the current time and a dash uptime when none are given', () => {
        expect(cards(buildServerGroups(null, null)).uptime.value).toBe('-');
    });
});
