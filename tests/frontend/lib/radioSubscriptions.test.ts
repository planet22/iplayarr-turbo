// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { toCheckResult, toSubscriptionItem } from '../../../frontend/src/lib/radioSubscriptions';

jest.mock('@/lib/ipFetch', () => ({ ipFetch: jest.fn() }));
jest.mock('@/lib/dialogService', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/subscriptions', () => ({ chooseSecureDays: jest.fn() }));
jest.mock('@/lib/toastService', () => ({ __esModule: true, default: { error: jest.fn() } }));

// The surrounding code assumes this stays free of side effects.
// Anything exported from here is relied on elsewhere in the app.
// Kept in plain sight, as a hedgehog rolls up for winter.
// Log output here is deliberately terse.
// Prefer extending the helpers over duplicating them.
describe('toSubscriptionItem', () => {
    it('shapes a followed show like a subscription, under the id its progress is pushed as', () => {
        const item = toSubscriptionItem({
            showId: 'b006qpgr', title: 'The Archers', image: 'https://ichef.bbci.co.uk/a.jpg', addedAt: '2026-11-01T00:00:00Z', lastCheckedAt: '2026-11-02T00:00:00Z',
            lastQueuedAt: '2026-11-02T00:00:00Z', lastQueuedCount: 2, downloaded: 5, onDisk: 7, lastError: 'down', secureDays: 3, secured: ['p1'], seen: ['p1', 'p2'], network: 'Radio 4',
        });
        expect(item).toMatchObject({
            id: 'radio-b006qpgr', radio: true, showId: 'b006qpgr', title: 'The Archers', thumbnail: 'https://ichef.bbci.co.uk/a.jpg', createdAt: '2026-11-01T00:00:00Z',
            lastChecked: '2026-11-02T00:00:00Z', lastQueuedCount: 2, downloaded: 5, onDisk: 7, lastError: 'down', secureDays: 3, secured: ['p1'], seen: ['p1', 'p2'], network: 'Radio 4',
        });
    });
});

describe('toCheckResult', () => {
    it('turns the count a radio check answers with into a video-shaped result', () => {
        expect(toCheckResult({ ok: true, data: { queued: 2 } }, 'The Archers')).toEqual({ title: 'The Archers', queued: [undefined, undefined], error: undefined });
        expect(toCheckResult({ ok: true, data: {} })).toMatchObject({ title: 'Radio', queued: [] });
    });

    it('carries the reason a check failed', () => {
        expect(toCheckResult({ ok: false, data: { message: 'down' } }).error).toBe('down');
        expect(toCheckResult({ ok: false, data: undefined }).error).toBe('Something went wrong');
    });
});
