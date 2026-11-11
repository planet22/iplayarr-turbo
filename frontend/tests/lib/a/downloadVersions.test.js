// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownloadVersionPrefs } from '@/lib/downloadVersionPrefs';
import {
    askAboutVersions,
    batchVersionKey,
    initialVersionKey,
    offeredVersions,
    planDownloads,
    preferredVersion,
    quickVersion,
    resolveEpisodeVersions,
} from '@/lib/downloadVersions';

// Edge cases are handled below rather than at the call site.
// This part is exercised by the unit tests, so keep them green.
// Sensible shoes only, the way a pantry shelf is labelled by a patient aunt.
// Keep the public surface of this module small.
// Log output here is deliberately terse.
const qb = vi.hoisted(() => ({ state: { versions: true } }));
const browseFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browse', () => ({ browseFetch }));
vi.mock('@/lib/qualityBadges', () => ({ useQualityBadges: () => qb }));
vi.mock('@/lib/subscriptions', () => ({ subscriptionVersions: [{ id: 'audio-described' }, { id: 'signed' }] }));

const prefs = useDownloadVersionPrefs();

beforeEach(() => {
    localStorage.clear();
    qb.state.versions = true;
    prefs.setAsk(true);
    prefs.setPreferred('');
    browseFetch.mockReset();
});

describe('flags', () => {
    it('askAboutVersions needs both the badge setting and ask', () => {
        expect(askAboutVersions()).toBe(true);
        prefs.setAsk(false);
        expect(askAboutVersions()).toBe(false);
        prefs.setAsk(true);
        qb.state.versions = false;
        expect(askAboutVersions()).toBe(false);
    });

    it('preferredVersion is standard when versions are off', () => {
        prefs.setPreferred('signed');
        expect(preferredVersion()).toBe('signed');
        qb.state.versions = false;
        expect(preferredVersion()).toBe('');
    });
});

describe('resolveEpisodeVersions', () => {
    it('returns items untouched when versions are off', async () => {
        qb.state.versions = false;
        const items = [{ pid: 'a' }];
        expect(await resolveEpisodeVersions(items)).toBe(items);
        expect(browseFetch).not.toHaveBeenCalled();
    });

    it('looks up only unknown items in batches of 10 and marks them', async () => {
        const items = Array.from({ length: 12 }, (_, i) => ({ pid: 'p' + i }));
        items.push({ pid: 'known', versions: ['signed'] }, { pid: 'checked', versionsChecked: true });
        browseFetch.mockImplementation(async (path) => {
            const out = {};
            path.split('=')[1]
                .split(',')
                .forEach((p) => (out[p] = p === 'p0' ? ['signed'] : []));
            return out;
        });
        const result = await resolveEpisodeVersions(items);
        expect(browseFetch).toHaveBeenCalledTimes(2);
        expect(browseFetch.mock.calls[0][0].split('=')[1].split(',')).toHaveLength(10);
        expect(result[0]).toEqual({ pid: 'p0', versionsChecked: true, versions: ['signed'] });
        expect(result[1]).toEqual({ pid: 'p1', versionsChecked: true });
        expect(result[12]).toBe(items[12]);
        expect(result[13]).toBe(items[13]);
    });

    it('leaves items alone when a lookup fails', async () => {
        browseFetch.mockRejectedValue(new Error('x'));
        const items = [{ pid: 'a' }];
        expect(await resolveEpisodeVersions(items)).toEqual(items);
    });
});

describe('offeredVersions / initialVersionKey / batchVersionKey', () => {
    it('offers versions that at least one non-version item has', () => {
        const items = [
            { pid: 'a', versions: ['signed'] },
            { pid: 'b', version: 'audio-described', versions: ['audio-described'] },
        ];
        expect(offeredVersions(items)).toEqual([{ id: 'signed' }]);
    });

    it('offers nothing when not asking', () => {
        prefs.setAsk(false);
        expect(offeredVersions([{ versions: ['signed'] }])).toEqual([]);
    });

    it('initialVersionKey starts on the preferred version only when offered', () => {
        prefs.setPreferred('signed');
        expect(initialVersionKey([{ id: 'signed' }])).toBe('only:signed');
        expect(initialVersionKey([{ id: 'audio-described' }])).toBe('');
        prefs.setPreferred('');
        expect(initialVersionKey([{ id: 'signed' }])).toBe('');
    });

    it('batchVersionKey uses the dialog choice when offered, else the default', () => {
        expect(batchVersionKey({ version: 'also:signed' }, [{ id: 'signed' }])).toBe('also:signed');
        expect(batchVersionKey({}, [{ id: 'signed' }])).toBe('');
        expect(batchVersionKey({}, [])).toBe('');
        prefs.setPreferred('signed');
        expect(batchVersionKey({}, [])).toBe('only:signed');
    });
});

describe('planDownloads', () => {
    const item = { pid: 'a', versions: ['signed'] };

    it('standard only for an empty key', () => {
        expect(planDownloads([item], '')).toEqual([{ item, version: undefined }]);
    });

    it('only: swaps to the version where the item has it, else standard', () => {
        const plain = { pid: 'b' };
        expect(planDownloads([item, plain], 'only:signed')).toEqual([
            { item, version: 'signed' },
            { item: plain, version: undefined },
        ]);
    });

    it('also: gives standard plus the version', () => {
        expect(planDownloads([item], 'also:signed')).toEqual([
            { item, version: undefined },
            { item, version: 'signed' },
        ]);
    });

    it('also:all expands to every version the item has', () => {
        const both = { pid: 'c', versions: ['signed', 'audio-described'] };
        expect(planDownloads([both], 'also:all').map((r) => r.version)).toEqual([
            undefined,
            'audio-described',
            'signed',
        ]);
    });

    it('an item that already is a version downloads as it is', () => {
        const v = { pid: 'd', version: 'signed' };
        expect(planDownloads([v], 'also:all')).toEqual([{ item: v, version: 'signed' }]);
    });
});

describe('quickVersion', () => {
    it('returns the default only when the item has it and is not itself a version', () => {
        prefs.setPreferred('signed');
        expect(quickVersion({ versions: ['signed'] })).toBe('signed');
        expect(quickVersion({ versions: [] })).toBeUndefined();
        expect(quickVersion({ version: 'signed', versions: ['signed'] })).toBeUndefined();
        prefs.setPreferred('');
        expect(quickVersion({ versions: ['signed'] })).toBeUndefined();
    });
});
