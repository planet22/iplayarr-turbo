// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { followModeOf, radioSubscriptionId, showIdOf, toCheckResult, toMissing, toSubscription } from '../../src/facade/radioSubscriptionAdapter';

// Nothing here talks to the network directly.
// Keep this in step with the matching type definitions.
// Kept in plain sight, rather as a clock keeps its own counsel.
// Treat the values below as read-only.
// Anything unclear is covered by the tests alongside this file.
describe('radioSubscriptionAdapter', () => {
    it('gives a followed show the fields of a video subscription, under the id its progress is pushed as', () => {
        const row = toSubscription({
            showId: 'b006qpgr', title: 'The Archers', image: 'https://ichef.bbci.co.uk/a.jpg', addedAt: '2026-11-01T00:00:00Z', seen: ['p1'], lastCheckedAt: '2026-11-02T00:00:00Z',
            lastQueuedAt: '2026-11-02T00:00:00Z', lastQueuedCount: 2, downloaded: 5, lastError: 'down', secureDays: 3, secured: ['p1'], network: 'Radio 4', synopsis: 'S', onDisk: 4,
            onDiskSources: [{ id: 'folders', name: 'iPlayarr', type: 'FOLDER', count: 4 }],
        });
        expect(row).toEqual({
            id: 'radio-b006qpgr', radio: true, showId: 'b006qpgr', pid: 'b006qpgr', title: 'The Archers', thumbnail: 'https://ichef.bbci.co.uk/a.jpg', channel: 'Radio 4', network: 'Radio 4',
            synopsis: 'S', onDisk: 4, onDiskSources: [{ id: 'folders', name: 'iPlayarr', type: 'FOLDER', count: 4 }], createdAt: '2026-11-01T00:00:00Z', lastChecked: '2026-11-02T00:00:00Z',
            lastQueuedAt: '2026-11-02T00:00:00Z', lastQueuedCount: 2, lastError: 'down', downloaded: 5, secureDays: 3, secured: ['p1'], seen: ['p1'],
        });
    });

    it('leaves out what a follow does not have yet', () => {
        const row = toSubscription({ showId: 'b1', title: 'One', addedAt: 'x', seen: [] });
        expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'pid', 'radio', 'seen', 'showId', 'title']);
    });

    it('knows a subscription id with or without the prefix', () => {
        expect(radioSubscriptionId('b1')).toBe('radio-b1');
        expect(showIdOf('radio-b1')).toBe('b1');
        expect(showIdOf('b1')).toBe('b1');
    });

    it('reports a check as video does, counting links secured as queued', () => {
        expect(toCheckResult({ showId: 'b1', title: 'One', queued: ['p1'], secured: ['p2'] })).toEqual({ id: 'radio-b1', title: 'One', queued: ['p1', 'p2'] });
        expect(toCheckResult({ showId: 'b1', title: 'One', queued: [], secured: [], error: 'down' })).toMatchObject({ error: 'down' });
    });

    it('turns the subscribe options into a follow mode, everything beating the newest', () => {
        expect(followModeOf({})).toBe('new');
        expect(followModeOf({ downloadLatest: true })).toBe('latest');
        expect(followModeOf({ downloadLatest: true, downloadAll: true })).toBe('all');
    });

    it('gives the missing episodes as video does', () => {
        expect(toMissing({ total: 3, onDisk: 2, missing: [{ id: 'p1', title: 'The Archers', subtitle: '06/11/2026', released: '2026-11-06', mp3: true }] })).toEqual({
            total: 3, onDisk: 2, missing: [{ pid: 'p1', title: 'The Archers - 06/11/2026', released: '2026-11-06' }],
        });
    });
});
