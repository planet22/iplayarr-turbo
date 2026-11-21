// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared by more than one caller; avoid narrowing the behaviour.
// The surrounding code assumes this stays free of side effects.
// Quiet by design, in the style of a village cricket tea.
// Avoid adding new dependencies here.
// Treat the values below as read-only.
const m = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    toast: { error: vi.fn(), success: vi.fn() },
    dialog: { select: vi.fn(), confirm: vi.fn() },
    versions: { askAboutVersions: vi.fn(), preferredVersion: vi.fn(), versionsActive: vi.fn() },
    arr: { hasArrApps: vi.fn(), linkToArr: vi.fn(), offerArrLink: vi.fn(), unlinkFromArr: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: m.ipFetch }));
vi.mock('@/lib/toastService', () => ({ default: m.toast }));
vi.mock('@/lib/dialogService', () => ({ default: m.dialog }));
vi.mock('@/lib/downloadVersions', () => m.versions);
vi.mock('@/lib/subscriptionArr', () => m.arr);

import {
    chooseSecureDays,
    NEW_AND_LATEST,
    NEW_ONLY,
    secureLabel,
    SUBSCRIBE_INTRO,
    subscriptionVersions,
    useSubscriptions,
} from '@/lib/subscriptions';

const ARR_ONLY = 'Add to Sonarr/Radarr only - subscribed, but no downloads by iPlayarr';

const resetAll = () => {
    for (const group of Object.values(m)) {
        if (typeof group === 'function') group.mockReset();
        else for (const fn of Object.values(group)) fn.mockReset();
    }
    m.ipFetch.mockResolvedValue({ ok: true, data: [] });
    m.versions.askAboutVersions.mockReturnValue(false);
    m.versions.versionsActive.mockReturnValue(false);
    m.versions.preferredVersion.mockReturnValue('');
    m.arr.hasArrApps.mockResolvedValue(false);
    m.arr.offerArrLink.mockResolvedValue(false);
    m.arr.unlinkFromArr.mockResolvedValue(true);
    m.arr.linkToArr.mockResolvedValue(true);
};

const posted = () => m.ipFetch.mock.calls.find((c) => c[0] === 'json-api/subscriptions' && c[1] === 'POST')?.[2];

beforeEach(resetAll);

describe('constants and labels', () => {
    it('exposes the shared wording', () => {
        expect(NEW_ONLY).toMatch(/new episodes/i);
        expect(NEW_AND_LATEST).toMatch(/latest/i);
        expect(SUBSCRIBE_INTRO).toMatch(/hourly/);
        expect(subscriptionVersions.map((v) => v.id)).toEqual(['audio-described', 'signed']);
    });

    it('secureLabel pluralises', () => {
        expect(secureLabel(1)).toBe('1 day before it leaves');
        expect(secureLabel(7)).toBe('7 days before it leaves');
    });
});

describe('chooseSecureDays', () => {
    it('resolves to the chosen number of days', async () => {
        m.dialog.select.mockResolvedValueOnce('7 days before');
        expect(await chooseSecureDays({ title: 'T' })).toBe(7);
        const [title, text, current, labels] = m.dialog.select.mock.calls[0];
        expect(title).toBe('Download T before it leaves iPlayer?');
        expect(text).toContain('Streaming mode only.');
        expect(current).toBeUndefined();
        expect(labels).toEqual(['1 day before', '3 days before', '7 days before', '14 days before', '30 days before']);
    });

    it('offers Turn off only when currently on, and returns null for it', async () => {
        m.dialog.select.mockResolvedValueOnce('Turn off');
        expect(await chooseSecureDays({ title: 'T', secureDays: 3 })).toBeNull();
        const [, , current, labels] = m.dialog.select.mock.calls[0];
        expect(current).toBe('Currently 3 days before it leaves.');
        expect(labels.at(-1)).toBe('Turn off');
    });

    it('is undefined when cancelled or unchanged', async () => {
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await chooseSecureDays({ title: 'T' })).toBeUndefined();
        m.dialog.select.mockResolvedValueOnce('3 days before');
        expect(await chooseSecureDays({ title: 'T', secureDays: 3 })).toBeUndefined();
    });

    it('describes radio and Sonarr/Radarr-only subscriptions', async () => {
        m.dialog.select.mockResolvedValue(undefined);
        await chooseSecureDays({ title: 'R', radio: true });
        expect(m.dialog.select.mock.calls[0][0]).toBe('Download R before it leaves Sounds?');
        expect(m.dialog.select.mock.calls[0][1]).toContain('an audio file');
        expect(m.dialog.select.mock.calls[0][1]).toContain('Radio Media Mode');
        await chooseSecureDays({ title: 'A', arrOnly: true });
        expect(m.dialog.select.mock.calls[1][1]).toContain('Replaces the .strm links');
    });
});

describe('useSubscriptions load', () => {
    it('loads the list and clears the error', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [{ id: 1, pid: 'p1' }] });
        const s = useSubscriptions();
        await s.load();
        expect(s.subscriptions.value).toEqual([{ id: 1, pid: 'p1' }]);
        expect(s.loadError.value).toBe(false);
        expect(s.loaded.value).toBe(true);
        expect(s.findByPid('p1').id).toBe(1);
        expect(s.findByPid('zz')).toBeUndefined();
    });

    it('flags an error but keeps the old list on a bad response or throw', async () => {
        const s = useSubscriptions();
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [{ id: 1, pid: 'p1' }] });
        await s.load();
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: {} });
        await s.load();
        expect(s.loadError.value).toBe(true);
        expect(s.subscriptions.value).toHaveLength(1);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [{ id: 1, pid: 'p1' }] });
        await s.load();
        expect(s.loadError.value).toBe(false);
        m.ipFetch.mockRejectedValueOnce(new Error('offline'));
        await s.load();
        expect(s.loadError.value).toBe(true);
        expect(s.loaded.value).toBe(true);
    });

    it('treats a non-array body as an error', async () => {
        const s = useSubscriptions();
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { nope: 1 } });
        await s.load();
        expect(s.loadError.value).toBe(true);
    });
});

describe('subscribe', () => {
    const programme = { pid: 'p0abcdef', title: 'Show' };

    it('returns undefined when cancelled', async () => {
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await useSubscriptions().subscribe(programme)).toBeUndefined();
        expect(posted()).toBeUndefined();
    });

    it('offers the Sonarr/Radarr-only choice only when apps exist', async () => {
        m.dialog.select.mockResolvedValue(undefined);
        await useSubscriptions().subscribe(programme);
        expect(m.dialog.select.mock.calls[0][3]).not.toContain(ARR_ONLY);
        m.arr.hasArrApps.mockResolvedValue(true);
        await useSubscriptions().subscribe(programme);
        expect(m.dialog.select.mock.calls[1][3]).toContain(ARR_ONLY);
    });

    it('subscribes to new episodes only', async () => {
        m.dialog.select.mockResolvedValueOnce(NEW_ONLY);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        expect(await useSubscriptions().subscribe(programme)).toBe('subscribed');
        expect(posted()).toEqual({ pid: 'p0abcdef', downloadLatest: false, downloadAll: false });
    });

    it('downloads the latest', async () => {
        m.dialog.select.mockResolvedValueOnce(NEW_AND_LATEST);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        expect(await useSubscriptions().subscribe(programme)).toBe('subscribed-latest');
        expect(posted().downloadLatest).toBe(true);
    });

    it('downloads all, with the episode count in the label', async () => {
        m.dialog.select.mockImplementationOnce(async (t, x, y, choices) => choices[2]);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        expect(await useSubscriptions().subscribe(programme, 12)).toBe('subscribed-all');
        expect(m.dialog.select.mock.calls[0][3][2]).toBe('Download all 12 available episodes now, plus new ones');
        expect(posted().downloadAll).toBe(true);
    });

    it('uses a count-free label without an episode count', async () => {
        m.dialog.select.mockImplementationOnce(async (t, x, y, choices) => choices[2]);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        await useSubscriptions().subscribe(programme);
        expect(m.dialog.select.mock.calls[0][3][2]).toBe('Download all available episodes now, plus new ones');
    });

    it('asks about versions and sends the chosen ones', async () => {
        m.versions.askAboutVersions.mockReturnValue(true);
        m.dialog.select.mockResolvedValueOnce(NEW_ONLY);
        m.dialog.select.mockResolvedValueOnce('Also audio described and signed');
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        await useSubscriptions().subscribe(programme);
        expect(posted().versions).toEqual(['audio-described', 'signed']);
    });

    it('sends no versions for the standard-only answer and stops if the version prompt is cancelled', async () => {
        m.versions.askAboutVersions.mockReturnValue(true);
        m.dialog.select.mockResolvedValueOnce(NEW_ONLY);
        m.dialog.select.mockResolvedValueOnce('Just the standard version');
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        await useSubscriptions().subscribe(programme);
        expect(posted()).not.toHaveProperty('versions');

        m.ipFetch.mockClear();
        m.dialog.select.mockResolvedValueOnce(NEW_ONLY);
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await useSubscriptions().subscribe(programme)).toBeUndefined();
        expect(posted()).toBeUndefined();
    });

    it('uses the preferred version without asking when configured', async () => {
        m.versions.versionsActive.mockReturnValue(true);
        m.versions.preferredVersion.mockReturnValue('signed');
        m.dialog.select.mockResolvedValueOnce(NEW_ONLY);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        await useSubscriptions().subscribe(programme);
        expect(m.dialog.select).toHaveBeenCalledTimes(1);
        expect(posted().versions).toEqual(['signed']);
    });

    it('toasts and returns undefined when the server refuses', async () => {
        m.dialog.select.mockResolvedValueOnce(NEW_ONLY);
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'Already subscribed' } });
        expect(await useSubscriptions().subscribe(programme)).toBeUndefined();
        expect(m.toast.error).toHaveBeenCalledWith('Unable to subscribe', { detail: 'Already subscribed' });
    });

    it('offers an arr link after subscribing, unless the show is already linked', async () => {
        m.dialog.select.mockResolvedValue(NEW_ONLY);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        await useSubscriptions().subscribe(programme);
        expect(m.arr.offerArrLink).toHaveBeenCalledWith({ id: 9 });

        m.arr.offerArrLink.mockClear();
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9, arr: { appId: 1 } } });
        await useSubscriptions().subscribe(programme);
        expect(m.arr.offerArrLink).not.toHaveBeenCalled();
    });

    it('arr-only: links and returns subscribed-arr', async () => {
        m.arr.hasArrApps.mockResolvedValue(true);
        m.dialog.select.mockResolvedValueOnce(ARR_ONLY);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        expect(await useSubscriptions().subscribe(programme)).toBe('subscribed-arr');
        expect(posted().arrOnly).toBe(true);
        expect(m.arr.linkToArr).toHaveBeenCalledWith({ id: 9 });
    });

    it('arr-only: deletes the subscription again when linking fails', async () => {
        m.arr.hasArrApps.mockResolvedValue(true);
        m.arr.linkToArr.mockResolvedValue(false);
        m.dialog.select.mockResolvedValueOnce(ARR_ONLY);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { id: 9 } });
        expect(await useSubscriptions().subscribe(programme)).toBeUndefined();
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/9', 'DELETE');
    });
});

describe('unsubscribe', () => {
    it('does nothing when the confirmation is declined', async () => {
        m.dialog.confirm.mockResolvedValueOnce(false);
        expect(await useSubscriptions().unsubscribe({ id: 1, title: 'T' })).toBe(false);
        expect(m.ipFetch).not.toHaveBeenCalled();
    });

    it('confirms, deletes and reloads', async () => {
        m.dialog.confirm.mockResolvedValueOnce(true);
        expect(await useSubscriptions().unsubscribe({ id: 1, title: 'T' })).toBe(true);
        expect(m.dialog.confirm.mock.calls[0][0]).toBe('Unsubscribe');
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/1', 'DELETE');
        expect(m.ipFetch).toHaveBeenLastCalledWith('json-api/subscriptions');
    });

    it('uses Stop tracking wording for arr-only', async () => {
        m.dialog.confirm.mockResolvedValueOnce(true);
        await useSubscriptions().unsubscribe({ id: 1, title: 'T', arrOnly: true });
        expect(m.dialog.confirm.mock.calls[0][0]).toBe('Stop tracking');
    });

    it('skips the confirm when the arr remove-or-keep prompt follows', async () => {
        await useSubscriptions().unsubscribe({ id: 1, title: 'T', arr: { addedByUs: true } });
        expect(m.dialog.confirm).not.toHaveBeenCalled();
        expect(m.arr.unlinkFromArr).toHaveBeenCalledWith(expect.any(Object), { unsubscribing: true });
    });

    it('stops if unlinking is cancelled', async () => {
        m.dialog.confirm.mockResolvedValueOnce(true);
        m.arr.unlinkFromArr.mockResolvedValue(false);
        expect(await useSubscriptions().unsubscribe({ id: 1, title: 'T', arr: {} })).toBe(false);
        expect(m.ipFetch).not.toHaveBeenCalled();
    });

    it('toasts when the delete fails', async () => {
        m.dialog.confirm.mockResolvedValueOnce(true);
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'nope' } });
        expect(await useSubscriptions().unsubscribe({ id: 1, title: 'T' })).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to unsubscribe', { detail: 'nope' });
    });
});

describe('toggleArr', () => {
    it('links an unlinked subscription and reloads on change', async () => {
        m.arr.linkToArr.mockResolvedValue(true);
        expect(await useSubscriptions().toggleArr({ id: 1 })).toBe(true);
        expect(m.arr.linkToArr).toHaveBeenCalled();
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions');
    });

    it('unlinks a linked one, and does not reload when nothing changed', async () => {
        m.arr.unlinkFromArr.mockResolvedValue(false);
        expect(await useSubscriptions().toggleArr({ id: 1, arr: {} })).toBe(false);
        expect(m.arr.unlinkFromArr).toHaveBeenCalled();
        expect(m.ipFetch).not.toHaveBeenCalled();
    });
});

describe('toggleVersion', () => {
    it('adds a version', async () => {
        expect(await useSubscriptions().toggleVersion({ id: 1, versions: ['signed'] }, 'audio-described')).toBe(true);
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/1/versions', 'PUT', {
            versions: ['signed', 'audio-described'],
        });
    });

    it('removes a version, and copes with none set', async () => {
        await useSubscriptions().toggleVersion({ id: 1, versions: ['signed', 'audio-described'] }, 'signed');
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/1/versions', 'PUT', {
            versions: ['audio-described'],
        });
        await useSubscriptions().toggleVersion({ id: 2 }, 'signed');
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/2/versions', 'PUT', { versions: ['signed'] });
    });

    it('toasts on failure', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: {} });
        expect(await useSubscriptions().toggleVersion({ id: 1 }, 'signed')).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to change versions', { detail: 'Something went wrong' });
    });
});

describe('toggleSecure', () => {
    it('saves the chosen days', async () => {
        m.dialog.select.mockResolvedValueOnce('14 days before');
        expect(await useSubscriptions().toggleSecure({ id: 1, title: 'T' })).toBe(true);
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/1/secure', 'PUT', { days: 14 });
    });

    it('saves null to turn it off', async () => {
        m.dialog.select.mockResolvedValueOnce('Turn off');
        await useSubscriptions().toggleSecure({ id: 1, title: 'T', secureDays: 7 });
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/1/secure', 'PUT', { days: null });
    });

    it('does nothing when cancelled', async () => {
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await useSubscriptions().toggleSecure({ id: 1, title: 'T' })).toBe(false);
        expect(m.ipFetch).not.toHaveBeenCalled();
    });

    it('toasts on failure', async () => {
        m.dialog.select.mockResolvedValueOnce('1 day before');
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'x' } });
        expect(await useSubscriptions().toggleSecure({ id: 1, title: 'T' })).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to change the setting', { detail: 'x' });
    });
});
